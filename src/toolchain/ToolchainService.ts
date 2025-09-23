//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as path from "path";
import * as plist from "plist";
import type * as vscode from "vscode";

import configuration from "../configuration";
import { Logger } from "../logging/Logger";
import { Environment } from "../services/Environment";
import { FileSystem } from "../services/FileSystem";
import { Shell } from "../services/Shell";
import { Swiftly } from "../swiftly/Swiftly";
import { expandFilePathTilde } from "../utilities/filesystem";
import { Result } from "../utilities/result";
import { lineBreakRegex } from "../utilities/tasks";
import { getXcodeDirectory } from "../utilities/utilities";
import { Version } from "../utilities/version";
import {
    DarwinCompatibleTarget,
    SwiftTargetInfo,
    SwiftToolchain,
    getDarwinSDKName,
} from "./SwiftToolchain";

export interface ToolchainService {
    create(folder: string): Promise<SwiftToolchain>;

    /**
     * Get active developer dir for Xcode
     */
    getXcodeDeveloperDir(env?: { [key: string]: string }): Promise<string>;

    /**
     * @param target Target to obtain the SDK path for
     * @returns path to the SDK for the target
     */
    getSDKForTarget(target: DarwinCompatibleTarget): Promise<string | undefined>;

    /**
     * @param sdk sdk name
     * @returns path to the SDK
     */
    getSDKPath(sdk: string): Promise<string | undefined>;

    /**
     * Get the list of Xcode applications installed on macOS.
     *
     * Note: this uses a combination of xcode-select and the Spotlight index and may not contain
     * all Xcode installations depending on the user's macOS settings.
     *
     * @returns an array of Xcode installations in no particular order.
     */
    findXcodeInstalls(): Promise<string[]>;

    /**
     * Checks common directories for available swift toolchain installations.
     *
     * @returns an array of toolchain paths
     */
    getToolchainInstalls(): Promise<string[]>;

    /**
     * Searches the given directory for any swift toolchain installations.
     *
     * @param directory the directory path to search in
     * @returns an array of toolchain paths
     */
    findToolchainsIn(directory: string): Promise<string[]>;

    /**
     * Returns the path to the CommandLineTools toolchain if its installed.
     */
    findCommandLineTools(): Promise<string[]>;
}

/**
 * Contents of **Info.plist** on Windows.
 */
interface InfoPlist {
    DefaultProperties: {
        XCTEST_VERSION: string | undefined;
        SWIFT_TESTING_VERSION: string | undefined;
    };
}

export class SwiftToolchainService implements ToolchainService {
    constructor(
        private readonly fs: FileSystem,
        private readonly config: typeof configuration,
        private readonly env: Environment,
        private readonly shell: Shell,
        private readonly window: typeof vscode.window,
        private readonly swiftly: Swiftly,
        private readonly logger: Logger
    ) {}

    async create(cwd: string): Promise<SwiftToolchain> {
        // Find the path to the Swift binary
        let swiftBinaryPath = await this.findSwiftBinary(cwd);
        swiftBinaryPath = await this.resolveSwiftEnvPath(swiftBinaryPath);
        swiftBinaryPath = await this.resolveXcodeSwiftPath(swiftBinaryPath);
        let isSwiftlyManaged = false;
        if (await this.swiftly.isSwiftlyToolchain(swiftBinaryPath)) {
            const swiftlyToolchainInfo = (await this.swiftly.getActiveToolchain(cwd)).getOrThrow();
            swiftBinaryPath = path.join(swiftlyToolchainInfo.location, "usr/bin/swift");
            isSwiftlyManaged = true;
        }
        const swiftFolderPath = path.dirname(swiftBinaryPath);
        // Grab toolchain information
        const targetInfo = await this.getSwiftTargetInfo(
            this.env.getExecutablePath(path.join(swiftFolderPath, "swift"))
        );
        const swiftVersion = this.getSwiftVersion(targetInfo);
        const [runtimePath, defaultSDK] = await Promise.all([
            this.getRuntimePath(targetInfo),
            this.getDefaultSDK(),
        ]);
        const customSDK = this.getCustomSDK();
        const [xcTestPath, swiftTestingPath, swiftPMTestingHelperPath] = await Promise.all([
            this.getXCTestPath(
                targetInfo,
                swiftFolderPath,
                swiftVersion,
                runtimePath,
                customSDK ?? defaultSDK
            ),
            this.getSwiftTestingPath(
                targetInfo,
                swiftVersion,
                runtimePath,
                customSDK ?? defaultSDK
            ),
            this.getSwiftPMTestingHelperPath(swiftFolderPath),
        ]);
        // Create the SwiftToolchain
        return new SwiftToolchain(
            this.env,
            swiftFolderPath,
            swiftFolderPath,
            targetInfo,
            swiftVersion,
            runtimePath,
            defaultSDK,
            customSDK,
            xcTestPath,
            swiftTestingPath,
            swiftPMTestingHelperPath,
            isSwiftlyManaged
        );
    }

    private async findSwiftBinary(cwd: string): Promise<string> {
        if (this.config.path !== "") {
            return this.config.path;
        }
        return this.shell.findBinaryPath("swift", { cwd });
    }

    private async resolveXcodeSwiftPath(swiftBinaryPath: string): Promise<string> {
        if (this.env.platform !== "darwin" || swiftBinaryPath !== "/usr/bin/swift") {
            return swiftBinaryPath;
        }

        return (await this.shell.execFile("xcrun", ["--find", "swift"])).stdout.trim();
    }

    /**
     * swiftenv is a popular way to install swift on Linux. It uses shim shell scripts
     * for all of the swift executables. This is problematic when we are trying to find
     * the lldb version. Also swiftenv can also change the swift version beneath which
     * could cause problems. This function will return the actual path to the swift
     * executable instead of the shim version
     *
     * @param swiftPath Path to swift folder
     * @returns Path to swift folder installed by swiftenv
     */
    private async resolveSwiftEnvPath(swiftBinaryPath: string): Promise<string> {
        if (this.env.platform !== "linux" || !swiftBinaryPath.endsWith(".swiftenv/shims")) {
            return swiftBinaryPath;
        }

        try {
            const swiftenvPath = path.dirname(swiftBinaryPath);
            const swiftenv = path.join(swiftenvPath, "libexec", "swiftenv");
            const { stdout } = await this.shell.execFile(swiftenv, ["which", "swift"]);
            const swift = stdout.trimEnd();
            return path.dirname(swift);
        } catch (error) {
            this.logger.error(error);
            return swiftBinaryPath;
        }
    }

    async getSDKForTarget(target: DarwinCompatibleTarget): Promise<string | undefined> {
        return await this.getSDKPath(getDarwinSDKName(target));
    }

    async getSDKPath(sdk: string): Promise<string | undefined> {
        // Include custom variables so that non-standard XCode installs can be better supported.
        const { stdout } = await this.shell.execFile("xcrun", ["--sdk", sdk, "--show-sdk-path"], {
            env: { ...process.env, ...configuration.swiftEnvironmentVariables },
        });
        return path.join(stdout.trimEnd());
    }

    async getXcodeDeveloperDir(env?: { [key: string]: string }): Promise<string> {
        const { stdout } = await this.shell.execFile("xcode-select", ["-p"], {
            env: env,
        });
        return stdout.trimEnd();
    }

    async findXcodeInstalls(): Promise<string[]> {
        if (process.platform !== "darwin") {
            return [];
        }

        // Use the Spotlight index and xcode-select to find available Xcode installations
        const [{ stdout: mdfindOutput }, xcodeDeveloperDir] = await Promise.all([
            this.shell.execFile("mdfind", [`kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'`]),
            this.getXcodeDeveloperDir(),
        ]);
        const spotlightXcodes =
            mdfindOutput.length > 0 ? mdfindOutput.trimEnd().split(lineBreakRegex) : [];
        const selectedXcode = getXcodeDirectory(xcodeDeveloperDir);

        // Combine the results from both commands
        const result = spotlightXcodes;
        if (selectedXcode && spotlightXcodes.find(xcode => xcode === selectedXcode) === undefined) {
            result.push(selectedXcode);
        }
        return result;
    }

    async getToolchainInstalls(): Promise<string[]> {
        if (process.platform !== "darwin") {
            return [];
        }
        // TODO: If Swiftly is managing these toolchains then omit them
        return Promise.all([
            this.findToolchainsIn("/Library/Developer/Toolchains/"),
            this.findToolchainsIn(path.join(this.env.homedir(), "Library/Developer/Toolchains/")),
            this.findCommandLineTools(),
        ]).then(results => results.flatMap(a => a));
    }

    async findToolchainsIn(directory: string): Promise<string[]> {
        try {
            const toolchains = await Promise.all(
                (await this.fs.readdir(directory, { withFileTypes: true }))
                    .filter(dirent => dirent.name.startsWith("swift-"))
                    .map(async dirent => {
                        const toolchainPath = path.join(dirent.path, dirent.name);
                        const toolchainSwiftPath = path.join(toolchainPath, "usr", "bin", "swift");
                        if (!(await this.fs.pathExists(toolchainSwiftPath))) {
                            return null;
                        }
                        return toolchainPath;
                    })
            );
            return toolchains.filter(
                (toolchain): toolchain is string => typeof toolchain === "string"
            );
        } catch {
            // Assume that there are no installations here
            return [];
        }
    }

    private async getSwiftFolderPath(
        folder: string
    ): Promise<{ path: string; isSwiftlyManaged: boolean }> {
        try {
            let swift: string;
            if (this.config.path !== "") {
                const windowsExeSuffix = process.platform === "win32" ? ".exe" : "";
                swift = path.join(this.config.path, `swift${windowsExeSuffix}`);
            } else {
                switch (this.env.platform) {
                    case "darwin": {
                        const { stdout } = await this.shell.execFile("which", ["swift"]);
                        swift = stdout.trimEnd();
                        break;
                    }
                    case "win32": {
                        const { stdout } = await this.shell.execFile("where", ["swift"]);
                        const paths = stdout.trimEnd().split("\r\n");
                        if (paths.length > 1) {
                            void this.window.showWarningMessage(
                                `Found multiple swift executables in in %PATH%. Using excutable found at ${paths[0]}`
                            );
                        }
                        swift = paths[0];
                        break;
                    }
                    default: {
                        swift = await this.shell.findBinaryPath("swift");
                        break;
                    }
                }
            }
            // swift may be a symbolic link
            let realSwift = await this.fs.realpath(swift);
            let isSwiftlyManaged = false;

            if (path.basename(realSwift) === "swiftly") {
                const inUse = (await this.swiftly.getActiveToolchain(folder))
                    .map(result => result.location)
                    .flatMapError(() => Result.success(""))
                    .getOrThrow();
                if (inUse !== "") {
                    realSwift = path.join(inUse, "usr", "bin", "swift");
                    isSwiftlyManaged = true;
                }
            }
            const swiftPath = expandFilePathTilde(path.dirname(realSwift));
            return {
                path: await this.resolveSwiftEnvPath(swiftPath),
                isSwiftlyManaged,
            };
        } catch (error) {
            this.logger.error(`Failed to find swift executable: ${error}`);
            throw Error("Failed to find swift executable");
        }
    }

    /**
     * @param targetInfo swift target info
     * @returns path to Swift runtime
     */
    async getRuntimePath(targetInfo: SwiftTargetInfo): Promise<string | undefined> {
        if (configuration.runtimePath !== "") {
            return configuration.runtimePath;
        } else if (process.platform === "win32") {
            const { stdout } = await this.shell.execFile("where", ["swiftCore.dll"]);
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
    async getDefaultSDK(): Promise<string | undefined> {
        switch (process.platform) {
            case "darwin": {
                if (process.env.SDKROOT) {
                    return process.env.SDKROOT;
                }

                return this.getSDKPath("macosx");
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
    getCustomSDK(): string | undefined {
        return configuration.sdk !== "" ? configuration.sdk : undefined;
    }

    /**
     * @returns path to the swiftpm-testing-helper binary, if it exists.
     */
    async getSwiftPMTestingHelperPath(toolchainPath: string): Promise<string | undefined> {
        if (process.platform === "darwin") {
            const toolchainSwiftPMHelperPath = path.join(
                toolchainPath,
                "libexec",
                "swift",
                "pm",
                "swiftpm-testing-helper"
            );

            // Verify that the helper exists. Older toolchains wont have it and thats ok,
            // it just means that XCTests and swift-testing tests exist in their own binaries
            // and can each be run separately. If this path exists we know the tests exist in
            // a unified binary and we need to use this utility to run the swift-testing tests
            // on macOS. XCTests are still run with the xctest utility on macOS. The test binaries
            // can be invoked directly on Linux/Windows.
            if (await this.fs.fileExists(toolchainSwiftPMHelperPath)) {
                return toolchainSwiftPMHelperPath;
            }
        }

        return undefined;
    }

    /**
     * @param targetInfo swift target info
     * @param swiftVersion parsed swift version
     * @param runtimePath path to Swift runtime
     * @param sdkroot path to swift SDK
     * @returns path to folder where xctest can be found
     */
    async getSwiftTestingPath(
        targetInfo: SwiftTargetInfo,
        swiftVersion: Version,
        runtimePath: string | undefined,
        sdkroot: string | undefined
    ): Promise<string | undefined> {
        if (process.platform !== "win32") {
            return undefined;
        }
        return this.getWindowsPlatformDLLPath(
            "Testing",
            targetInfo,
            swiftVersion,
            runtimePath,
            sdkroot
        );
    }

    /**
     * @param targetInfo swift target info
     * @param swiftVersion parsed swift version
     * @param runtimePath path to Swift runtime
     * @param sdkroot path to swift SDK
     * @returns path to folder where xctest can be found
     */
    async getXCTestPath(
        targetInfo: SwiftTargetInfo,
        swiftFolderPath: string,
        swiftVersion: Version,
        runtimePath: string | undefined,
        sdkroot: string | undefined
    ): Promise<string | undefined> {
        switch (process.platform) {
            case "darwin": {
                const xcodeDirectory = getXcodeDirectory(swiftFolderPath);
                const swiftEnvironmentVariables = configuration.swiftEnvironmentVariables;
                if (xcodeDirectory && !("DEVELOPER_DIR" in swiftEnvironmentVariables)) {
                    swiftEnvironmentVariables["DEVELOPER_DIR"] = xcodeDirectory;
                }
                const developerDir = await this.getXcodeDeveloperDir(swiftEnvironmentVariables);
                return path.join(developerDir, "usr", "bin");
            }
            case "win32": {
                return await this.getWindowsPlatformDLLPath(
                    "XCTest",
                    targetInfo,
                    swiftVersion,
                    runtimePath,
                    sdkroot
                );
            }
        }
        return undefined;
    }

    async getWindowsPlatformDLLPath(
        type: "XCTest" | "Testing",
        targetInfo: SwiftTargetInfo,
        swiftVersion: Version,
        runtimePath: string | undefined,
        sdkroot: string | undefined
    ): Promise<string | undefined> {
        // look up runtime library directory for XCTest/Testing alternatively
        const fallbackPath =
            runtimePath !== undefined &&
            (await this.fs.pathExists(path.join(runtimePath, `${type}.dll`)))
                ? runtimePath
                : undefined;
        if (!sdkroot) {
            return fallbackPath;
        }

        const platformPath = path.dirname(path.dirname(path.dirname(sdkroot)));
        const platformManifest = path.join(platformPath, "Info.plist");
        if ((await this.fs.pathExists(platformManifest)) !== true) {
            if (fallbackPath) {
                return fallbackPath;
            }
            void this.window.showWarningMessage(
                `${type} not found due to non-standardized library layout. Tests explorer won't work as expected.`
            );
            return undefined;
        }
        const data = await this.fs.readFile(platformManifest, "utf8");
        let infoPlist;
        try {
            infoPlist = plist.parse(data) as unknown as InfoPlist;
        } catch (error) {
            void this.window.showWarningMessage(`Unable to parse ${platformManifest}: ${error}`);
            return undefined;
        }
        const plistKey = type === "XCTest" ? "XCTEST_VERSION" : "SWIFT_TESTING_VERSION";
        const version = infoPlist.DefaultProperties[plistKey];
        if (!version) {
            this.logger.warn(`${platformManifest} is missing the ${plistKey} key.`);
            return undefined;
        }

        if (swiftVersion.isGreaterThanOrEqual(new Version(5, 7, 0))) {
            let bindir: string;
            const arch = targetInfo.target?.triple.split("-", 1)[0];
            switch (arch) {
                case "x86_64":
                    bindir = "bin64";
                    break;
                case "i686":
                    bindir = "bin32";
                    break;
                case "aarch64":
                    bindir = "bin64a";
                    break;
                default:
                    throw Error(`unsupported architecture ${arch}`);
            }
            return path.join(
                platformPath,
                "Developer",
                "Library",
                `${type}-${version}`,
                "usr",
                bindir
            );
        } else {
            return path.join(
                platformPath,
                "Developer",
                "Library",
                `${type}-${version}`,
                "usr",
                "bin"
            );
        }
    }

    /** @returns swift target info */
    async getSwiftTargetInfo(swiftExecutable: string): Promise<SwiftTargetInfo> {
        try {
            try {
                const { stdout } = await this.shell.execSwift(["-print-target-info"], {
                    swiftExecutable,
                });
                const targetInfo = JSON.parse(stdout.trimEnd()) as SwiftTargetInfo;
                if (targetInfo.compilerVersion) {
                    return targetInfo;
                }
            } catch {
                // hit error while running `swift -print-target-info`. We are possibly running
                // a version of swift 5.3 or older
            }
            const { stdout } = await this.shell.execSwift(["--version"], { swiftExecutable });
            return {
                compilerVersion: stdout.split(lineBreakRegex, 1)[0],
                paths: { runtimeLibraryPaths: [""] },
            };
        } catch {
            throw Error(
                "Failed to get swift version from either '-print-target-info' or '--version'."
            );
        }
    }

    /**
     * @param targetInfo swift target info
     * @returns swift version object
     */
    getSwiftVersion(targetInfo: SwiftTargetInfo): Version {
        const match = targetInfo.compilerVersion.match(/Swift version ([\S]+)/);
        let version: Version | undefined;
        if (match) {
            version = Version.fromString(match[1]);
        }
        return version ?? new Version(0, 0, 0);
    }

    async findCommandLineTools(): Promise<string[]> {
        const commandLineToolsPath = "/Library/Developer/CommandLineTools";
        if (!(await this.fs.pathExists(commandLineToolsPath))) {
            return [];
        }

        const toolchainSwiftPath = path.join(commandLineToolsPath, "usr", "bin", "swift");
        if (!(await this.fs.pathExists(toolchainSwiftPath))) {
            return [];
        }
        return [commandLineToolsPath];
    }
}
