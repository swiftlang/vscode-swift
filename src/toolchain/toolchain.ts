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
import configuration from "../configuration";
import { SwiftOutputChannel } from "../ui/SwiftOutputChannel";
import { execFile, execSwift } from "../utilities/utilities";
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
        public sdkroot?: string,
        public xcTestPath?: string
    ) {}

    static async create(): Promise<SwiftToolchain> {
        const version = await this.getSwiftVersion();
        const toolchainPath = await this.getToolchainPath();
        const sdkroot = this.getSDKROOT();
        const xcTestPath = await this.getXCTestPath(sdkroot);
        return new SwiftToolchain(
            version.name,
            version.version,
            toolchainPath,
            sdkroot,
            xcTestPath
        );
    }

    logDiagnostics(channel: SwiftOutputChannel) {
        channel.logDiagnostic(`Toolchain Path: ${this.toolchainPath}`);
        if (this.sdkroot) {
            channel.logDiagnostic(`SDKROOT: ${this.sdkroot}`);
        }
        if (this.xcTestPath) {
            channel.logDiagnostic(`XCTestPath: ${this.xcTestPath}`);
        }
    }

    /**
     * @returns path to Toolchain folder
     */
    private static async getToolchainPath(): Promise<string | undefined> {
        if (configuration.path !== "") {
            return path.dirname(path.dirname(configuration.path));
        } else if (process.platform === "darwin") {
            const { stdout } = await execFile("xcrun", ["--find", "swiftc"]);
            const swiftc = stdout.trimEnd();
            return path.dirname(path.dirname(path.dirname(swiftc)));
        } else if (process.platform === "linux") {
            const { stdout } = await execFile("which", ["swiftc"]);
            const swiftc = stdout.trimEnd();
            return path.dirname(path.dirname(path.dirname(swiftc)));
        } else if (process.platform === "win32") {
            const { stdout } = await execFile("where", ["swiftc"]);
            const swiftc = stdout.trimEnd();
            return path.dirname(path.dirname(path.dirname(swiftc)));
        }
        return undefined;
    }

    private static getSDKROOT(): string | undefined {
        if (process.platform === "win32") {
            return process.env.SDKROOT ?? undefined;
        }
        return undefined;
    }

    /**
     * @param developerDir Developer directory
     * @returns Path to folder where xctest can be found
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
                const data = await fs.readFile(path.join(platformPath, "Info.plist"), "utf8");
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

    /** Return swift version string returned by `swift --version` */
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
}
