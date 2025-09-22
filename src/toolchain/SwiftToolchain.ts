//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as path from "path";
import * as vscode from "vscode";

import { SwiftLogger } from "../logging/SwiftLogger";
import { Environment } from "../services/Environment";
import { pathExists } from "../utilities/filesystem";
import { execFile, execSwift, getXcodeDirectory } from "../utilities/utilities";
import { Version } from "../utilities/version";
import { BuildFlags } from "./BuildFlags";
import { Sanitizer } from "./Sanitizer";

/**
 * Project template information retrieved from `swift package init --help`
 */
export interface SwiftProjectTemplate {
    id: string;
    name: string;
    description: string;
}

/**
 * Stripped layout of `swift -print-target-info` output.
 */
export interface SwiftTargetInfo {
    compilerVersion: string;
    target?: {
        triple: string;
        unversionedTriple: string;
        [name: string]: string | string[];
    };
    paths: {
        runtimeLibraryPaths: string[];
        [name: string]: string | string[];
    };
    [name: string]: string | object | undefined;
}

/**
 * A Swift compilation target that can be compiled to
 * from macOS. These are similar to XCode's target list.
 */
export enum DarwinCompatibleTarget {
    iOS = "iOS",
    tvOS = "tvOS",
    watchOS = "watchOS",
    visionOS = "xrOS",
}

export function getDarwinSDKName(target: DarwinCompatibleTarget): string {
    switch (target) {
        case DarwinCompatibleTarget.iOS:
            return "iphoneos";
        case DarwinCompatibleTarget.tvOS:
            return "appletvos";
        case DarwinCompatibleTarget.watchOS:
            return "watchos";
        case DarwinCompatibleTarget.visionOS:
            return "xros";
    }
}

export function getDarwinTargetTriple(target: DarwinCompatibleTarget): string | undefined {
    switch (target) {
        case DarwinCompatibleTarget.iOS:
            return "arm64-apple-ios";
        case DarwinCompatibleTarget.tvOS:
            return "arm64-apple-tvos";
        case DarwinCompatibleTarget.watchOS:
            return "arm64-apple-watchos";
        case DarwinCompatibleTarget.visionOS:
            return "arm64-apple-xros";
    }
}

export class SwiftToolchain {
    public swiftVersionString: string;

    constructor(
        private readonly env: Environment,
        public swiftFolderPath: string, // folder swift executable in $PATH was found in
        public toolchainPath: string, // toolchain folder. One folder up from swift bin folder. This is to support toolchains without usr folder
        private targetInfo: SwiftTargetInfo,
        public swiftVersion: Version, // Swift version as semVar variable
        public runtimePath?: string, // runtime library included in output from `swift -print-target-info`
        public defaultSDK?: string,
        public customSDK?: string,
        public xcTestPath?: string,
        public swiftTestingPath?: string,
        public swiftPMTestingHelperPath?: string,
        public isSwiftlyManaged: boolean = false // true if this toolchain is managed by Swiftly
    ) {
        this.swiftVersionString = targetInfo.compilerVersion;
    }

    public get unversionedTriple(): string | undefined {
        return this.targetInfo.target?.unversionedTriple;
    }

    /** build flags */
    public get buildFlags(): BuildFlags {
        return new BuildFlags(this);
    }

    /** build flags */
    public sanitizer(name: string): Sanitizer | undefined {
        return Sanitizer.create(name, this);
    }

    /**
     * Returns true if the console output of `swift test --parallel` prints results
     * to stdout with newlines or not.
     */
    public get hasMultiLineParallelTestOutput(): boolean {
        return (
            this.swiftVersion.isLessThanOrEqual(new Version(5, 6, 0)) ||
            this.swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0))
        );
    }

    /**
     * Get a list of new project templates from swift package manager
     * @returns a {@link SwiftProjectTemplate} for each discovered project type
     */
    public async getProjectTemplates(): Promise<SwiftProjectTemplate[]> {
        // Only swift versions >=5.8.0 are supported
        if (this.swiftVersion.isLessThan(new Version(5, 8, 0))) {
            return [];
        }
        // Parse the output from `swift package init --help`
        const { stdout } = await execSwift(["package", "init", "--help"], "default");
        const lines = stdout.split(/\r?\n/g);
        // Determine where the `--type` option is documented
        let position = lines.findIndex(line => line.trim().startsWith("--type"));
        if (position === -1) {
            throw new Error("Unable to parse output from `swift package init --help`");
        }
        // Loop through the possible project types in the output
        position += 1;
        const result: SwiftProjectTemplate[] = [];
        const typeRegex = /^\s*([a-zA-z-]+)\s+-\s+(.+)$/;
        for (; position < lines.length; position++) {
            const line = lines[position];
            // Stop if we hit a new command line option
            if (line.trim().startsWith("--")) {
                break;
            }
            // Check if this is the start of a new project type
            const match = line.match(typeRegex);
            if (match) {
                const nameSegments = match[1].split("-");
                result.push({
                    id: match[1],
                    name: nameSegments
                        .map(seg => seg[0].toLocaleUpperCase() + seg.slice(1))
                        .join(" "),
                    description: match[2],
                });
            } else {
                // Continuation of the previous project type
                result[result.length - 1].description += " " + line.trim();
            }
        }
        return result;
    }

    /**
     * Return fullpath for toolchain executable
     */
    public getToolchainExecutable(executable: string): string {
        return this.env.getExecutablePath(path.join(this.toolchainPath, executable));
    }

    /**
     * Returns the path to the LLDB executable inside the selected toolchain.
     * If the user is on macOS and has no OSS toolchain selected, also search
     * inside Xcode.
     * @returns The path to the `lldb` executable
     * @throws Throws an error if the executable cannot be found
     */
    public async getLLDB(): Promise<string> {
        return this.findToolchainOrXcodeExecutable("lldb");
    }

    /**
     * Returns the path to the LLDB debug adapter executable inside the selected
     * toolchain. If the user is on macOS and has no OSS toolchain selected, also
     * search inside Xcode.
     * @returns The path to the `lldb-dap` executable
     * @throws Throws an error if the executable cannot be found
     */
    public async getLLDBDebugAdapter(): Promise<string> {
        return this.findToolchainOrXcodeExecutable("lldb-dap");
    }

    /**
     * Search for the supplied executable in the toolchain.
     * If the user is on macOS and has no OSS toolchain selected, also
     * search inside Xcode.
     */
    private async findToolchainOrXcodeExecutable(executable: string): Promise<string> {
        if (this.env.platform === "win32") {
            executable += ".exe";
        }
        const toolchainExecutablePath = path.join(this.swiftFolderPath, executable);

        if (await pathExists(toolchainExecutablePath)) {
            return toolchainExecutablePath;
        }

        if (this.env.platform !== "darwin") {
            throw new Error(
                `Failed to find ${executable} within Swift toolchain '${this.toolchainPath}'`
            );
        }
        return this.findXcodeExecutable(executable);
    }

    private async findXcodeExecutable(executable: string): Promise<string> {
        const xcodeDirectory = getXcodeDirectory(this.toolchainPath);
        if (!xcodeDirectory) {
            throw new Error(
                `Failed to find ${executable} within Swift toolchain '${this.toolchainPath}'`
            );
        }
        try {
            const { stdout } = await execFile("xcrun", ["-find", executable], {
                env: { ...this.env.env(), DEVELOPER_DIR: xcodeDirectory },
            });
            return stdout.trimEnd();
        } catch (error) {
            throw new Error(
                `Failed to find ${executable} within Xcode Swift toolchain '${xcodeDirectory}'`,
                { cause: error }
            );
        }
    }

    private basePlatformDeveloperPath(): string | undefined {
        const sdk = this.customSDK ?? this.defaultSDK;
        if (!sdk) {
            return undefined;
        }
        return path.resolve(sdk, "../../");
    }

    /**
     * Library path for swift-testing executables
     */
    public swiftTestingLibraryPath(): string | undefined {
        let result = "";
        const base = this.basePlatformDeveloperPath();
        if (base) {
            result = `${path.join(base, "usr/lib")}:`;
        }
        return `${result}${path.join(this.toolchainPath, "lib/swift/macosx/testing")}`;
    }

    /**
     * Framework path for swift-testing executables
     */
    public swiftTestingFrameworkPath(): string | undefined {
        const base = this.basePlatformDeveloperPath();
        if (!base) {
            return undefined;
        }
        const frameworks = path.join(base, "Library/Frameworks");
        const privateFrameworks = path.join(base, "Library/PrivateFrameworks");
        return `${frameworks}:${privateFrameworks}`;
    }

    get diagnostics(): string {
        let str = "";
        str += this.swiftVersionString;
        str += `\nPlatform: ${this.env.platform}`;
        str += `\nVS Code Version: ${vscode.version}`;
        str += `\nSwift Path: ${this.swiftFolderPath}`;
        str += `\nToolchain Path: ${this.toolchainPath}`;
        if (this.runtimePath) {
            str += `\nRuntime Library Path: ${this.runtimePath}`;
        }
        if (this.targetInfo.target?.triple) {
            str += `\nDefault Target: ${this.targetInfo.target?.triple}`;
        }
        if (this.defaultSDK) {
            str += `\nDefault SDK: ${this.defaultSDK}`;
        }
        if (this.customSDK) {
            str += `\nCustom SDK: ${this.customSDK}`;
        }
        if (this.xcTestPath) {
            str += `\nXCTest Path: ${this.xcTestPath}`;
        }
        return str;
    }

    logDiagnostics(logger: SwiftLogger) {
        logger.debug(this.diagnostics);
    }
}
