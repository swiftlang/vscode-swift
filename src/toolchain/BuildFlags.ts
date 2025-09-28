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
import { Version } from "../utilities/version";
import { DarwinCompatibleTarget, SwiftToolchain, getDarwinTargetTriple } from "./toolchain";

/** Target info */
export interface DarwinTargetInfo {
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
                    default:
                        // Other swift-package subcommands operate on the host,
                        // so it doesn't need to know about the destination.
                        return subcommand.concat(args);
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
            if (this.toolchain.swiftVersion.isLessThan(new Version(5, 8, 0))) {
                return ["--build-path", configuration.buildPath];
            } else {
                return ["--scratch-path", configuration.buildPath];
            }
        } else {
            return [];
        }
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
        const nodePath =
            platform === "posix" ? path.posix : platform === "win32" ? path.win32 : path;
        const buildPath = configuration.buildPath.length > 0 ? configuration.buildPath : ".build";
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
        cwd: string,
        workspacePath: string,
        buildConfiguration: "debug" | "release" = "debug",
        logger: SwiftLogger
    ): Promise<string> {
        // Checking the bin path requires a swift process execution, so we maintain a cache.
        // The cache key is based on workspace, configuration, and build arguments.
        const buildArgsHash = JSON.stringify(configuration.buildArguments);
        const cacheKey = `${workspacePath}:${buildConfiguration}:${buildArgsHash}`;

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
            ...binPathAffectingArgs(configuration.buildArguments),
        ];

        try {
            // Execute swift build --show-bin-path
            const result = await execSwift(fullArgs, this.toolchain, { cwd });
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
        if (exclude) {
            // remove arguments that match the filter
            const filteredArguments: string[] = [];
            let skipCount = 0;

            for (const arg of args) {
                if (skipCount > 0) {
                    // Skip this argument as it's a parameter to an excluded flag
                    skipCount -= 1;
                    continue;
                }

                // Check if this is an excluded argument
                const excludeFilter = filter.find(item => item.argument === arg);
                if (excludeFilter) {
                    // Skip this argument and any parameters it takes
                    skipCount = excludeFilter.include;
                    continue;
                }

                // Check for arguments of form --arg=value
                const excludeFilter2 = filter.find(
                    item => item.include === 1 && arg.startsWith(item.argument + "=")
                );
                if (excludeFilter2) {
                    // Skip this combined argument
                    continue;
                }

                // This argument is not excluded, so include it
                filteredArguments.push(arg);
            }

            return filteredArguments;
        } else {
            // keep only arguments that match the filter
            const filteredArguments: string[] = [];
            let includeCount = 0;
            for (const arg of args) {
                if (includeCount > 0) {
                    filteredArguments.push(arg);
                    includeCount -= 1;
                    continue;
                }
                const argFilter = filter.find(item => item.argument === arg);
                if (argFilter) {
                    filteredArguments.push(arg);
                    includeCount = argFilter.include;
                    continue;
                }
                // find arguments of form arg=value
                const argFilter2 = filter.find(
                    item => item.include === 1 && arg.startsWith(item.argument + "=")
                );
                if (argFilter2) {
                    filteredArguments.push(arg);
                }
            }
            return filteredArguments;
        }
    }
}
