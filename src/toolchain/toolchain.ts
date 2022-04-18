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
import { execFile, execSwift, getExecutableName, pathExists } from "../utilities/utilities";
import { Version } from "../utilities/version";

/**
 * Contents of **Info.plist** on Windows.
 */
interface InfoPlist {
    DefaultProperties: {
        XCTEST_VERSION: string | undefined;
    };
}

export class SwiftToolchain {
    constructor(
        public swiftVersionString: string,
        public swiftVersion: Version,
        public toolchainPath?: string,
        private defaultSDK?: string,
        private customSDK?: string,
        public xcTestPath?: string,
        public newSwiftDriver?: boolean
    ) {}

    static async create(): Promise<SwiftToolchain> {
        const version = await this.getSwiftVersion();
        const toolchainPath = await this.getToolchainPath();
        const defaultSDK = await this.getDefaultSDK();
        const customSDK = this.getCustomSDK();
        const xcTestPath = await this.getXCTestPath(defaultSDK);
        const newSwiftDriver = await this.checkNewDriver(toolchainPath);
        return new SwiftToolchain(
            version.name,
            version.version,
            toolchainPath,
            defaultSDK,
            customSDK,
            xcTestPath,
            newSwiftDriver
        );
    }

    logDiagnostics(channel: SwiftOutputChannel) {
        channel.logDiagnostic(`Toolchain Path: ${this.toolchainPath}`);
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
            case "linux": {
                const { stdout } = await execFile("which", ["swiftc"]);
                const swiftc = stdout.trimEnd();
                return path.dirname(path.dirname(path.dirname(swiftc)));
            }
            case "win32": {
                const { stdout } = await execFile("where", ["swiftc"]);
                const swiftc = stdout.trimEnd();
                return path.dirname(path.dirname(path.dirname(swiftc)));
            }
        }
        return undefined;
    }

    /**
     * @returns path to default SDK
     */
    private static async getDefaultSDK(): Promise<string | undefined> {
        switch (process.platform) {
            case "darwin": {
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
     * @param sdkroot path to default SDK
     * @returns path to folder where xctest can be found
     */
    private static async getXCTestPath(sdkroot: string | undefined): Promise<string | undefined> {
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

    /**
     * @returns swift version string returned by `swift --version`
     */
    private static async getSwiftVersion(): Promise<{ name: string; version: Version }> {
        try {
            const { stdout } = await execSwift(["--version"]);
            const versionString = stdout.split("\n", 1)[0];
            // extract version
            const match = versionString.match(/Swift version ([\S]+)/);
            let version: Version | undefined;
            if (match) {
                version = Version.fromString(match[1]);
            }
            return { name: versionString, version: version ?? new Version(0, 0, 0) };
        } catch {
            throw Error("Cannot find swift executable.");
        }
    }

    /**
     * @returns if the default Swift driver is the new driver
     */
    private static async checkNewDriver(
        toolchainPath: string | undefined
    ): Promise<boolean | undefined> {
        if (!toolchainPath) {
            return undefined;
        }
        const toolDirectory = path.join(toolchainPath, "usr", "bin");
        // judge from environment variable
        if (process.env.SWIFT_USE_NEW_DRIVER) {
            return true;
        }
        if (process.env.SWIFT_USE_OLD_DRIVER) {
            return false;
        }
        // judge from tool existence
        if (await pathExists(toolDirectory, getExecutableName("swift-driver"))) {
            return true;
        }
        if ((await pathExists(toolDirectory, getExecutableName("swift-frontend"))) !== true) {
            return false;
        }
        // check if swift is symlinked into swift-frontend
        const swiftDriverPath = await fs.realpath(
            path.join(toolDirectory, getExecutableName("swift"))
        );
        const swiftFrontendPath = await fs.realpath(
            path.join(toolDirectory, getExecutableName("swift-frontend"))
        );
        if (swiftDriverPath === swiftFrontendPath) {
            return false;
        }
        // check if swift is replaced by the new driver
        const swiftDriverBuffer = await fs.readFile(swiftDriverPath);
        const swiftFrontendBuffer = await fs.readFile(swiftFrontendPath);
        return !swiftDriverBuffer.equals(swiftFrontendBuffer);
    }
}
