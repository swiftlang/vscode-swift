//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as path from "path";

import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { execSwift } from "../utilities/utilities";
import { DarwinCompatibleTarget, SwiftToolchain, getDarwinTargetTriple } from "./toolchain";

/** Target info */
interface DarwinTargetInfo {
    name: string;
    target: DarwinCompatibleTarget;
    version: string;
}

export interface ArgumentFilter {
    argument: string;
    include: number;
}

export class BuildFlags {
    private static buildPathCache = new Map<string, string>();

    constructor(public toolchain: SwiftToolchain) {}

    /**
     * Get modified swift arguments with SDK flags.
     *
     * @param args original commandline arguments
     */
    private withSwiftSDKFlags(args: string[]): string[] {
        switch (args[0]) {
            case "package": {
                if (args[1] === "plugin") {
                    // Don't append build path flags for `swift package plugin` commands
                    return args;
                }
                const subcommand = args.splice(0, 2).concat(this.buildPathFlags());
                switch (subcommand[1]) {
                    case "dump-symbol-graph":
                    case "diagnose-api-breaking-changes":
                    case "resolve": {
                        // These two tools require building the package, so SDK
                        // flags are needed. Destination control flags are
                        // required to be placed before subcommand options.
                        return [...subcommand, ...this.swiftpmSDKFlags(), ...args];
                    }
                }
            }
            case "build":
            case "run":
            case "test": {
                const subcommand = args.splice(0, 1).concat(this.buildPathFlags());
                return [...subcommand, ...this.swiftpmSDKFlags(), ...args];
            }
            default:
                // We're not going to call the Swift compiler directly for cross-compiling
                // and the destination settings are package-only, so do nothing here.
                return args;
        }
    }

    withSwiftPackageFlags(args: string[]): string[] {
        switch (args[0]) {
            case "package": {
                if (args[1] === "init") {
                    return args;
                }
                const newArgs = [...args];
                newArgs.splice(1, 0, ...configuration.packageArguments);
                return newArgs;
            }
            case "build":
            case "run":
            case "test":
                return [...args, ...configuration.packageArguments];
            default:
                return args;
        }
    }

    /**
     * Get SDK flags for SwiftPM
     */
    swiftpmSDKFlags(): string[] {
        const flags: string[] = [];
        if (configuration.sdk !== "") {
            flags.push("--sdk", configuration.sdk, ...this.swiftDriverTargetFlags(true));
        }
        if (configuration.swiftSDK !== "") {
            flags.push("--swift-sdk", configuration.swiftSDK);
        }
        return flags;
    }

    /**
     * Get build path flags to be passed to swift package manager and sourcekit-lsp server
     */
    buildPathFlags(): string[] {
        if (configuration.buildPath && configuration.buildPath.length > 0) {
            return ["--scratch-path", configuration.buildPath];
        } else {
            return [];
        }
    }

    private static readonly scratchPathFlags = ["--scratch-path", "--build-path"];

    private static validatePath(flagName: string, value: string): string {
        if (value === "") {
            throw new Error(`Invalid ${flagName}: path cannot be empty`);
        }
        if (value.startsWith("--")) {
            throw new Error(`Invalid ${flagName}: expected a path but got another flag '${value}'`);
        }
        return value;
    }

    private static parseEqualsForm(arg: string): string | undefined {
        for (const flag of BuildFlags.scratchPathFlags) {
            if (arg.startsWith(`${flag}=`)) {
                return BuildFlags.validatePath(flag, arg.substring(flag.length + 1));
            }
        }
        return undefined;
    }

    /**
     * Extract scratch-path or build-path value from an array of arguments
     * @param args Array of command-line arguments to search
     * @returns The path value if found, otherwise undefined
     */
    private static extractScratchPath(args: string[]): string | undefined {
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (BuildFlags.scratchPathFlags.includes(arg) && i + 1 < args.length) {
                return BuildFlags.validatePath(arg, args[i + 1]);
            }
            const equalsResult = BuildFlags.parseEqualsForm(arg);
            if (equalsResult !== undefined) {
                return equalsResult;
            }
        }
        return undefined;
    }

    /**
     * Get build path from configuration if exists or return a fallback .build directory in given workspace
     * @param filesystem path to workspace that will be used as a fallback loacation with .build directory
     */
    static buildDirectoryFromWorkspacePath(
        workspacePath: string,
        absolute = false,
        platform?: "posix" | "win32"
    ): string {
        const platformPaths = {
            posix: path.posix,
            win32: path.win32,
        };
        const nodePath = platform ? platformPaths[platform] : path;

        const buildPath =
            BuildFlags.extractScratchPath(configuration.buildArguments) ??
            BuildFlags.extractScratchPath(configuration.packageArguments) ??
            (configuration.buildPath.length > 0 ? configuration.buildPath : ".build");

        if (!nodePath.isAbsolute(buildPath) && absolute) {
            return nodePath.join(workspacePath, buildPath);
        } else {
            return buildPath;
        }
    }

    /**
     * Get SDK flags for swiftc
     *
     * @param indirect whether to pass the flags by -Xswiftc
     */
    swiftDriverSDKFlags(indirect = false): string[] {
        if (configuration.sdk === "") {
            return [];
        }
        const args = ["-sdk", configuration.sdk];
        return indirect ? args.flatMap(arg => ["-Xswiftc", arg]) : args;
    }

    /**
     * @returns Darwin target information. Target id, name and version
     */
    getDarwinTarget(): DarwinTargetInfo | undefined {
        const targetMap = [
            { name: "iPhoneOS", target: DarwinCompatibleTarget.iOS },
            { name: "AppleTVOS", target: DarwinCompatibleTarget.tvOS },
            { name: "WatchOS", target: DarwinCompatibleTarget.watchOS },
            { name: "XROS", target: DarwinCompatibleTarget.visionOS },
        ];

        if (configuration.sdk === "" || process.platform !== "darwin") {
            return undefined;
        }

        const sdkKindParts = configuration.sdk.split("/");
        const sdkKind = sdkKindParts[sdkKindParts.length - 1];
        for (const target of targetMap) {
            if (sdkKind.includes(target.name)) {
                // Obtain the version of the SDK.
                const version = sdkKind.substring(
                    // Trim the prefix
                    target.name.length,
                    // Trim the `.sdk` suffix
                    sdkKind.length - 4
                );
                return { ...target, version: version };
            }
        }
        return undefined;
    }

    /**
     * Get target flags for swiftc
     *
     * @param indirect whether to pass the flags by -Xswiftc
     */
    swiftDriverTargetFlags(indirect = false): string[] {
        const target = this.getDarwinTarget();
        if (!target) {
            return [];
        }
        const args = ["-target", `${getDarwinTargetTriple(target.target)}${target.version}`];
        return indirect ? args.flatMap(arg => ["-Xswiftc", arg]) : args;
    }

    /**
     * Get modified swift arguments with new arguments for disabling
     * sandboxing if the `swift.disableSandbox` setting is enabled.
     *
     * @param args original commandline arguments
     */
    private withDisableSandboxFlags(args: string[]): string[] {
        if (!configuration.disableSandbox) {
            return args;
        }
        const disableSandboxFlags = ["--disable-sandbox", "-Xswiftc", "-disable-sandbox"];
        switch (args[0]) {
            case "package": {
                if (args[1] === "plugin") {
                    return args;
                }
                return [args[0], ...disableSandboxFlags, ...args.slice(1)];
            }
            case "build":
            case "run":
            case "test": {
                return [...args, ...disableSandboxFlags];
            }
            default:
                // Do nothing for other commands
                return args;
        }
    }

    /**
     * Get the build binary path using swift build --show-bin-path.
     * This respects all build configuration including buildArguments, buildSystem, etc.
     *
     * @param workspacePath Path to the workspace
     * @param configuration Build configuration (debug or release)
     * @returns Promise resolving to the build binary path
     */
    async getBuildBinaryPath(
        workspacePath: string,
        buildConfiguration: "debug" | "release" = "debug",
        logger: SwiftLogger,
        idSuffix: string = "",
        extraArgs: string[] = []
    ): Promise<string> {
        // Checking the bin path requires a swift process execution, so we maintain a cache.
        // The cache key is based on workspace, configuration, and build arguments.
        const buildArgsHash = JSON.stringify(configuration.buildArguments);
        const cacheKey = `${workspacePath}:${buildConfiguration}:${buildArgsHash}${idSuffix}`;

        if (BuildFlags.buildPathCache.has(cacheKey)) {
            return BuildFlags.buildPathCache.get(cacheKey)!;
        }

        // Filters down build arguments to those affecting the bin path
        const binPathAffectingArgs = (args: string[]) =>
            BuildFlags.filterArguments(args, [
                { argument: "--scratch-path", include: 1 },
                { argument: "--build-system", include: 1 },
            ]);

        const baseArgs = ["build", "--show-bin-path", "--configuration", buildConfiguration];
        const fullArgs = [
            ...this.withAdditionalFlags(baseArgs),
            ...binPathAffectingArgs([...configuration.buildArguments, ...extraArgs]),
        ];

        try {
            // Execute swift build --show-bin-path
            const result = await execSwift(fullArgs, this.toolchain, {
                cwd: workspacePath,
            });
            const binPath = result.stdout.trim();

            // Cache the result
            BuildFlags.buildPathCache.set(cacheKey, binPath);
            return binPath;
        } catch (error) {
            logger.warn(
                `Failed to get build binary path using 'swift ${fullArgs.join(" ")}. Falling back to traditional path construction. error: ${error}`
            );
            // Fallback to traditional path construction if command fails
            const fallbackPath = path.join(
                BuildFlags.buildDirectoryFromWorkspacePath(workspacePath, true),
                buildConfiguration
            );
            return fallbackPath;
        }
    }

    /**
     * Clear the build path cache. Should be called when build configuration changes.
     */
    static clearBuildPathCache(): void {
        BuildFlags.buildPathCache.clear();
    }

    withAdditionalFlags(args: string[]): string[] {
        return this.withSwiftPackageFlags(
            this.withDisableSandboxFlags(this.withSwiftSDKFlags(args))
        );
    }

    /**
     *  Filter argument list with support for both inclusion and exclusion logic
     * @param args argument list
     * @param filter argument list filter
     * @param exclude if true, remove matching arguments (exclusion mode); if false, keep only matching arguments (inclusion mode)
     * @returns filtered argument list
     */
    static filterArguments(args: string[], filter: ArgumentFilter[], exclude = false): string[] {
        const filteredArguments: string[] = [];
        let pendingCount = 0;

        for (const arg of args) {
            const isMatchedByPending = pendingCount > 0;
            if (isMatchedByPending) {
                pendingCount -= 1;
            }

            const exactMatch = isMatchedByPending
                ? undefined
                : this.findExactMatchingFilter(arg, filter);
            if (exactMatch) {
                pendingCount = exactMatch.include;
            }

            const matched =
                isMatchedByPending || !!exactMatch || this.isCombinedArgMatch(arg, filter);
            if (matched !== exclude) {
                filteredArguments.push(arg);
            }
        }

        return filteredArguments;
    }

    private static findExactMatchingFilter(
        arg: string,
        filter: ArgumentFilter[]
    ): ArgumentFilter | undefined {
        return filter.find(item => item.argument === arg);
    }

    private static isCombinedArgMatch(arg: string, filter: ArgumentFilter[]): boolean {
        return filter.some(item => item.include === 1 && arg.startsWith(item.argument + "="));
    }
}
