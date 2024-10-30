//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 Apple Inc. and the VS Code Swift project authors
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
import { SwiftToolchain, DarwinCompatibleTarget, getDarwinTargetTriple } from "./toolchain";
import { Version } from "../utilities/version";

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
    constructor(public toolchain: SwiftToolchain) {}

    /**
     * Get modified swift arguments with SDK flags.
     *
     * @param args original commandline arguments
     */
    withSwiftSDKFlags(args: string[]): string[] {
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

    /**
     * Get SDK flags for SwiftPM
     */
    swiftpmSDKFlags(): string[] {
        if (configuration.sdk !== "") {
            return ["--sdk", configuration.sdk, ...this.swiftDriverTargetFlags(true)];
        }
        return [];
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
     *  Filter argument list
     * @param args argument list
     * @param filter argument list filter
     * @returns filtered argument list
     */
    static filterArguments(args: string[], filter: ArgumentFilter[]): string[] {
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
