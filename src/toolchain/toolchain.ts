//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as fs from "fs/promises";
import * as path from "path";
import * as plist from "plist";
import * as vscode from "vscode";
import configuration from "../configuration";
import { SwiftOutputChannel } from "../ui/SwiftOutputChannel";
import { execFile, execSwift, pathExists } from "../utilities/utilities";
import { Version } from "../utilities/version";

/**
 * Contents of **Info.plist** on Windows.
 */
interface InfoPlist {
    DefaultProperties: {
        XCTEST_VERSION: string | undefined;
    };
}

/**
 * Stripped layout of `swift -print-target-info` output.
 */
interface SwiftTargetInfo {
    compilerVersion: string;
    target?: {
        triple: string;
        [name: string]: string | string[];
    };
    paths: {
        runtimeLibraryPaths: string[];
        [name: string]: string | string[];
    };
    [name: string]: string | object | undefined;
}

export class SwiftToolchain {
    constructor(
        public toolchainPath: string | undefined,
        public swiftVersionString: string,
        public swiftVersion: Version,
        public runtimePath?: string,
        private defaultTarget?: string,
        private defaultSDK?: string,
        private customSDK?: string,
        public xcTestPath?: string
    ) {}

    static async create(): Promise<SwiftToolchain> {
        const toolchainPath = await this.getToolchainPath();
        const targetInfo = await this.getSwiftTargetInfo();
        const swiftVersion = await this.getSwiftVersion(targetInfo);
        const runtimePath = await this.getRuntimePath(targetInfo);
        const defaultSDK = await this.getDefaultSDK();
        const customSDK = this.getCustomSDK();
        const xcTestPath = await this.getXCTestPath(runtimePath, defaultSDK);
        return new SwiftToolchain(
            toolchainPath,
            targetInfo.compilerVersion,
            swiftVersion,
            runtimePath,
            targetInfo.target?.triple,
            defaultSDK,
            customSDK,
            xcTestPath
        );
    }

    logDiagnostics(channel: SwiftOutputChannel) {
        channel.logDiagnostic(`Toolchain Path: ${this.toolchainPath}`);
        if (this.runtimePath) {
            channel.logDiagnostic(`Runtime Library Path: ${this.runtimePath}`);
        }
        if (this.defaultTarget) {
            channel.logDiagnostic(`Default Target: ${this.defaultTarget}`);
        }
        if (this.defaultSDK) {
            channel.logDiagnostic(`Default SDK: ${this.defaultSDK}`);
        }
        if (this.customSDK) {
            channel.logDiagnostic(`Custom SDK: ${this.customSDK}`);
        }
        if (this.xcTestPath) {
            channel.logDiagnostic(`XCTest Path: ${this.xcTestPath}`);
        }
    }

    /**
     * @returns path to Toolchain folder
     */
    private static async getToolchainPath(): Promise<string | undefined> {
        if (configuration.path !== "") {
            return path.dirname(path.dirname(configuration.path));
        }
        switch (process.platform) {
            case "darwin": {
                const { stdout } = await execFile("xcrun", ["--find", "swiftc"]);
                const swiftc = stdout.trimEnd();
                return path.dirname(path.dirname(path.dirname(swiftc)));
            }
            case "win32": {
                const { stdout } = await execFile("where", ["swiftc"]);
                const swiftc = stdout.trimEnd();
                return path.dirname(path.dirname(path.dirname(swiftc)));
            }
            default: {
                // use `type swiftc` to find `swiftc`. Run inside /bin/sh to ensure
                // we get consistent output as different shells output a different
                // format. Tried running with `-p` but that is not available in /bin/sh
                const { stdout } = await execFile("/bin/sh", ["-c", "type swiftc"]);
                const swiftcMatch = /^swiftc is (.*)$/.exec(stdout);
                if (swiftcMatch) {
                    const swiftc = swiftcMatch[1];
                    return path.dirname(path.dirname(path.dirname(swiftc)));
                }
                break;
            }
        }
    }

    /**
     * @param targetInfo swift target info
     * @returns path to Swift runtime
     */
    private static async getRuntimePath(targetInfo: SwiftTargetInfo): Promise<string | undefined> {
        if (configuration.runtimePath !== "") {
            return configuration.runtimePath;
        } else if (process.platform === "win32") {
            const { stdout } = await execFile("where", ["swiftCore.dll"]);
            const swiftCore = stdout.trimEnd();
            return swiftCore.length > 0 ? path.dirname(swiftCore) : undefined;
        } else {
            return targetInfo.paths.runtimeLibraryPaths.length > 0
                ? targetInfo.paths.runtimeLibraryPaths.join(":")
                : undefined;
        }
    }

    /**
     * @returns path to default SDK
     */
    private static async getDefaultSDK(): Promise<string | undefined> {
        switch (process.platform) {
            case "darwin": {
                if (process.env.SDKROOT) {
                    return process.env.SDKROOT;
                }
                const { stdout } = await execFile("xcrun", ["--sdk", "macosx", "--show-sdk-path"]);
                return path.join(stdout.trimEnd());
            }
            case "win32": {
                return process.env.SDKROOT;
            }
        }
        return undefined;
    }

    /**
     * @returns path to custom SDK
     */
    private static getCustomSDK(): string | undefined {
        return configuration.sdk !== "" ? configuration.sdk : undefined;
    }

    /**
     * @param runtimePath path to Swift runtime
     * @param sdkroot path to default SDK
     * @returns path to folder where xctest can be found
     */
    private static async getXCTestPath(
        runtimePath: string | undefined,
        sdkroot: string | undefined
    ): Promise<string | undefined> {
        switch (process.platform) {
            case "darwin": {
                const { stdout } = await execFile("xcode-select", ["-p"]);
                return path.join(stdout.trimEnd(), "usr", "bin");
            }
            case "win32": {
                if (!sdkroot) {
                    return undefined;
                }
                const platformPath = path.dirname(path.dirname(path.dirname(sdkroot)));
                const platformManifest = path.join(platformPath, "Info.plist");
                if ((await pathExists(platformManifest)) !== true) {
                    // look up runtime library directory for XCTest
                    if (runtimePath && (await pathExists(path.join(runtimePath, "XCTest.dll")))) {
                        return runtimePath;
                    }
                    await vscode.window.showWarningMessage(
                        "XCTest not found due to non-standardized library layout. Tests explorer won't work as expected."
                    );
                    return undefined;
                }
                const data = await fs.readFile(platformManifest, "utf8");
                const infoPlist = plist.parse(data) as unknown as InfoPlist;
                const version = infoPlist.DefaultProperties.XCTEST_VERSION;
                if (!version) {
                    throw Error("Info.plist is missing the XCTEST_VERSION key.");
                }
                return path.join(
                    platformPath,
                    "Developer",
                    "Library",
                    `XCTest-${version}`,
                    "usr",
                    "bin"
                );
            }
        }
        return undefined;
    }

    /** @returns swift target info */
    private static async getSwiftTargetInfo(): Promise<SwiftTargetInfo> {
        try {
            const { stdout } = await execSwift(["-print-target-info"]);
            return JSON.parse(stdout.trimEnd()) as SwiftTargetInfo;
        } catch {
            throw Error("Cannot parse swift target info output.");
        }
    }

    /**
     * @param targetInfo swift target info
     * @returns swift version object
     */
    private static getSwiftVersion(targetInfo: SwiftTargetInfo): Version {
        const match = targetInfo.compilerVersion.match(/Swift version ([\S]+)/);
        let version: Version | undefined;
        if (match) {
            version = Version.fromString(match[1]);
        }
        return version ?? new Version(0, 0, 0);
    }
}
