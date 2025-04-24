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

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as plist from "plist";
import * as vscode from "vscode";
import configuration from "../configuration";
import { SwiftOutputChannel } from "../ui/SwiftOutputChannel";
import { execFile, execSwift } from "../utilities/utilities";
import { expandFilePathTilde, pathExists } from "../utilities/filesystem";
import { Version } from "../utilities/version";
import { BuildFlags } from "./BuildFlags";
import { Sanitizer } from "./Sanitizer";
import { SwiftlyConfig, ToolchainVersion } from "./ToolchainVersion";

/**
 * Contents of **Info.plist** on Windows.
 */
interface InfoPlist {
    DefaultProperties: {
        XCTEST_VERSION: string | undefined;
        SWIFT_TESTING_VERSION: string | undefined;
    };
}

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
interface SwiftTargetInfo {
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
        public swiftFolderPath: string, // folder swift executable in $PATH was found in
        public toolchainPath: string, // toolchain folder. One folder up from swift bin folder. This is to support toolchains without usr folder
        private targetInfo: SwiftTargetInfo,
        public swiftVersion: Version, // Swift version as semVar variable
        public runtimePath?: string, // runtime library included in output from `swift -print-target-info`
        public defaultSDK?: string,
        public customSDK?: string,
        public xcTestPath?: string,
        public swiftTestingPath?: string,
        public swiftPMTestingHelperPath?: string
    ) {
        this.swiftVersionString = targetInfo.compilerVersion;
    }

    static async create(): Promise<SwiftToolchain> {
        const swiftFolderPath = await this.getSwiftFolderPath();
        const toolchainPath = await this.getToolchainPath(swiftFolderPath);
        const targetInfo = await this.getSwiftTargetInfo();
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
            this.getSwiftPMTestingHelperPath(toolchainPath),
        ]);

        return new SwiftToolchain(
            swiftFolderPath,
            toolchainPath,
            targetInfo,
            swiftVersion,
            runtimePath,
            defaultSDK,
            customSDK,
            xcTestPath,
            swiftTestingPath,
            swiftPMTestingHelperPath
        );
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
     * Get active developer dir for Xcode
     */
    public static async getXcodeDeveloperDir(env?: { [key: string]: string }): Promise<string> {
        const { stdout } = await execFile("xcode-select", ["-p"], {
            env: env,
        });
        return stdout.trimEnd();
    }

    /**
     * @param target Target to obtain the SDK path for
     * @returns path to the SDK for the target
     */
    public static async getSDKForTarget(
        target: DarwinCompatibleTarget
    ): Promise<string | undefined> {
        return await this.getSDKPath(getDarwinSDKName(target));
    }

    /**
     * @param sdk sdk name
     * @returns path to the SDK
     */
    static async getSDKPath(sdk: string): Promise<string | undefined> {
        // Include custom variables so that non-standard XCode installs can be better supported.
        const { stdout } = await execFile("xcrun", ["--sdk", sdk, "--show-sdk-path"], {
            env: { ...process.env, ...configuration.swiftEnvironmentVariables },
        });
        return path.join(stdout.trimEnd());
    }

    /**
     * Get list of Xcode versions intalled on mac
     * @returns Folders for each Xcode install
     */
    public static async getXcodeInstalls(): Promise<string[]> {
        if (process.platform !== "darwin") {
            return [];
        }
        const { stdout: xcodes } = await execFile("mdfind", [
            `kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'`,
        ]);
        // An empty string means no Xcodes are installed.
        if (xcodes.length === 0) {
            return [];
        }
        return xcodes.trimEnd().split("\n");
    }

    /**
     * Finds the list of toolchains managed by Swiftly.
     *
     * @returns an array of toolchain paths
     */
    public static async getSwiftlyToolchainInstalls(): Promise<string[]> {
        // Swiftly is only available on Linux right now
        // TODO: Add support for macOS
        if (process.platform !== "linux") {
            return [];
        }
        try {
            const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
            if (!swiftlyHomeDir) {
                return [];
            }
            const swiftlyConfig = await SwiftToolchain.getSwiftlyConfig();
            if (!swiftlyConfig || !("installedToolchains" in swiftlyConfig)) {
                return [];
            }
            const installedToolchains = swiftlyConfig.installedToolchains;
            if (!Array.isArray(installedToolchains)) {
                return [];
            }
            return installedToolchains
                .filter((toolchain): toolchain is string => typeof toolchain === "string")
                .map(toolchain => path.join(swiftlyHomeDir, "toolchains", toolchain));
        } catch (error) {
            throw new Error("Failed to retrieve Swiftly installations from disk.");
        }
    }

    /**
     * Reads the Swiftly configuration file, if it exists.
     *
     * @returns A parsed Swiftly configuration.
     */
    private static async getSwiftlyConfig(): Promise<SwiftlyConfig | undefined> {
        const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
        if (!swiftlyHomeDir) {
            return;
        }
        const swiftlyConfigRaw = await fs.readFile(
            path.join(swiftlyHomeDir, "config.json"),
            "utf-8"
        );
        return JSON.parse(swiftlyConfigRaw);
    }

    /**
     * Checks common directories for available swift toolchain installations.
     *
     * @returns an array of toolchain paths
     */
    public static async getToolchainInstalls(): Promise<string[]> {
        if (process.platform !== "darwin") {
            return [];
        }
        // TODO: If Swiftly is managing these toolchains then omit them
        return Promise.all([
            this.findToolchainsIn("/Library/Developer/Toolchains/"),
            this.findToolchainsIn(path.join(os.homedir(), "Library/Developer/Toolchains/")),
            this.findCommandLineTools(),
        ]).then(results => results.flatMap(a => a));
    }

    /**
     * Searches the given directory for any swift toolchain installations.
     *
     * @param directory the directory path to search in
     * @returns an array of toolchain paths
     */
    public static async findToolchainsIn(directory: string): Promise<string[]> {
        try {
            const toolchains = await Promise.all(
                (await fs.readdir(directory, { withFileTypes: true }))
                    .filter(dirent => dirent.name.startsWith("swift-"))
                    .map(async dirent => {
                        const toolchainPath = path.join(dirent.path, dirent.name);
                        const toolchainSwiftPath = path.join(toolchainPath, "usr", "bin", "swift");
                        if (!(await pathExists(toolchainSwiftPath))) {
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
     * Returns the path to the CommandLineTools toolchain if its installed.
     */
    public static async findCommandLineTools(): Promise<string[]> {
        const commandLineToolsPath = "/Library/Developer/CommandLineTools";
        if (!(await pathExists(commandLineToolsPath))) {
            return [];
        }

        const toolchainSwiftPath = path.join(commandLineToolsPath, "usr", "bin", "swift");
        if (!(await pathExists(toolchainSwiftPath))) {
            return [];
        }
        return [commandLineToolsPath];
    }

    /**
     * Return fullpath for toolchain executable
     */
    public getToolchainExecutable(executable: string): string {
        // should we add `.exe` at the end of the executable name
        const executableSuffix = process.platform === "win32" ? ".exe" : "";
        return path.join(this.toolchainPath, "bin", executable + executableSuffix);
    }

    private static getXcodeDirectory(toolchainPath: string): string | undefined {
        let xcodeDirectory = toolchainPath;
        while (path.extname(xcodeDirectory) !== ".app") {
            xcodeDirectory = path.dirname(xcodeDirectory);
            if (path.parse(xcodeDirectory).base === "") {
                return undefined;
            }
        }
        return xcodeDirectory;
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
        if (process.platform === "win32") {
            executable += ".exe";
        }
        const toolchainExecutablePath = path.join(this.swiftFolderPath, executable);

        if (await pathExists(toolchainExecutablePath)) {
            return toolchainExecutablePath;
        }

        if (process.platform !== "darwin") {
            throw new Error(
                `Failed to find ${executable} within Swift toolchain '${this.toolchainPath}'`
            );
        }
        return this.findXcodeExecutable(executable);
    }

    private async findXcodeExecutable(executable: string): Promise<string> {
        const xcodeDirectory = SwiftToolchain.getXcodeDirectory(this.toolchainPath);
        if (!xcodeDirectory) {
            throw new Error(
                `Failed to find ${executable} within Swift toolchain '${this.toolchainPath}'`
            );
        }
        try {
            const { stdout } = await execFile("xcrun", ["-find", executable], {
                env: { ...process.env, DEVELOPER_DIR: xcodeDirectory },
            });
            return stdout.trimEnd();
        } catch (error) {
            let errorMessage = `Failed to find ${executable} within Xcode Swift toolchain '${xcodeDirectory}'`;
            if (error instanceof Error) {
                errorMessage += `:\n${error.message}`;
            }
            throw new Error(errorMessage);
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
        str += `\nPlatform: ${process.platform}`;
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

    logDiagnostics(channel: SwiftOutputChannel) {
        channel.logDiagnostic(this.diagnostics);
    }

    private static async getSwiftFolderPath(): Promise<string> {
        try {
            let swift: string;
            if (configuration.path !== "") {
                const windowsExeSuffix = process.platform === "win32" ? ".exe" : "";
                swift = path.join(configuration.path, `swift${windowsExeSuffix}`);
            } else {
                switch (process.platform) {
                    case "darwin": {
                        const { stdout } = await execFile("which", ["swift"]);
                        swift = stdout.trimEnd();
                        break;
                    }
                    case "win32": {
                        const { stdout } = await execFile("where", ["swift"]);
                        const paths = stdout.trimEnd().split("\r\n");
                        if (paths.length > 1) {
                            vscode.window.showWarningMessage(
                                `Found multiple swift executables in in %PATH%. Using excutable found at ${paths[0]}`
                            );
                        }
                        swift = paths[0];
                        break;
                    }
                    default: {
                        // use `type swift` to find `swift`. Run inside /bin/sh to ensure
                        // we get consistent output as different shells output a different
                        // format. Tried running with `-p` but that is not available in /bin/sh
                        const { stdout } = await execFile("/bin/sh", [
                            "-c",
                            "LC_MESSAGES=C type swift",
                        ]);
                        const swiftMatch = /^swift is (.*)$/.exec(stdout.trimEnd());
                        if (swiftMatch) {
                            swift = swiftMatch[1];
                        } else {
                            throw Error("Failed to find swift executable");
                        }
                        break;
                    }
                }
            }
            // swift may be a symbolic link
            const realSwift = await fs.realpath(swift);
            const swiftPath = expandFilePathTilde(path.dirname(realSwift));
            return await this.getSwiftEnvPath(swiftPath);
        } catch {
            throw Error("Failed to find swift executable");
        }
    }

    /**
     * swiftenv is a popular way to install swift on Linux. It uses shim shell scripts
     * for all of the swift executables. This is problematic when we are trying to find
     * the lldb version. Also swiftenv can also change the swift version beneath which
     * could cause problems. This function will return the actual path to the swift
     * executable instead of the shim version
     * @param swiftPath Path to swift folder
     * @returns Path to swift folder installed by swiftenv
     */
    private static async getSwiftEnvPath(swiftPath: string): Promise<string> {
        if (process.platform === "linux" && swiftPath.endsWith(".swiftenv/shims")) {
            try {
                const swiftenvPath = path.dirname(swiftPath);
                const swiftenv = path.join(swiftenvPath, "libexec", "swiftenv");
                const { stdout } = await execFile(swiftenv, ["which", "swift"]);
                const swift = stdout.trimEnd();
                return path.dirname(swift);
            } catch {
                return swiftPath;
            }
        } else {
            return swiftPath;
        }
    }

    /**
     * @returns path to Toolchain folder
     */
    private static async getToolchainPath(swiftPath: string): Promise<string> {
        try {
            switch (process.platform) {
                case "darwin": {
                    if (configuration.path !== "") {
                        return path.dirname(configuration.path);
                    }

                    const swiftlyToolchainLocation = await this.swiftlyToolchainLocation();
                    if (swiftlyToolchainLocation) {
                        return swiftlyToolchainLocation;
                    }

                    const { stdout } = await execFile("xcrun", ["--find", "swift"], {
                        env: configuration.swiftEnvironmentVariables,
                    });
                    const swift = stdout.trimEnd();
                    return path.dirname(path.dirname(swift));
                }
                default: {
                    return path.dirname(swiftPath);
                }
            }
        } catch {
            throw Error("Failed to find swift toolchain");
        }
    }

    /**
     * Determine if Swiftly is being used to manage the active toolchain and if so, return
     * the path to the active toolchain.
     * @returns The location of the active toolchain if swiftly is being used to manage it.
     */
    private static async swiftlyToolchainLocation(): Promise<string | undefined> {
        const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
        if (swiftlyHomeDir) {
            const { stdout: swiftLocation } = await execFile("which", ["swift"]);
            if (swiftLocation.indexOf(swiftlyHomeDir) === 0) {
                const swiftlyConfig = await SwiftToolchain.getSwiftlyConfig();
                if (swiftlyConfig) {
                    const version = ToolchainVersion.parse(swiftlyConfig.inUse);
                    return path.join(
                        os.homedir(),
                        "Library/Developer/Toolchains/",
                        `${version.identifier}.xctoolchain`,
                        "usr"
                    );
                }
            }
        }
        return undefined;
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
    private static getCustomSDK(): string | undefined {
        return configuration.sdk !== "" ? configuration.sdk : undefined;
    }

    /**
     * @returns path to the swiftpm-testing-helper binary, if it exists.
     */
    private static async getSwiftPMTestingHelperPath(
        toolchainPath: string
    ): Promise<string | undefined> {
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
            if (await this.fileExists(toolchainSwiftPMHelperPath)) {
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
    private static async getSwiftTestingPath(
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
    private static async getXCTestPath(
        targetInfo: SwiftTargetInfo,
        swiftFolderPath: string,
        swiftVersion: Version,
        runtimePath: string | undefined,
        sdkroot: string | undefined
    ): Promise<string | undefined> {
        switch (process.platform) {
            case "darwin": {
                const xcodeDirectory = this.getXcodeDirectory(swiftFolderPath);
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

    private static async getWindowsPlatformDLLPath(
        type: "XCTest" | "Testing",
        targetInfo: SwiftTargetInfo,
        swiftVersion: Version,
        runtimePath: string | undefined,
        sdkroot: string | undefined
    ): Promise<string | undefined> {
        // look up runtime library directory for XCTest/Testing alternatively
        const fallbackPath =
            runtimePath !== undefined && (await pathExists(path.join(runtimePath, `${type}.dll`)))
                ? runtimePath
                : undefined;
        if (!sdkroot) {
            return fallbackPath;
        }

        const platformPath = path.dirname(path.dirname(path.dirname(sdkroot)));
        const platformManifest = path.join(platformPath, "Info.plist");
        if ((await pathExists(platformManifest)) !== true) {
            if (fallbackPath) {
                return fallbackPath;
            }
            vscode.window.showWarningMessage(
                `${type} not found due to non-standardized library layout. Tests explorer won't work as expected.`
            );
            return undefined;
        }
        const data = await fs.readFile(platformManifest, "utf8");
        let infoPlist;
        try {
            infoPlist = plist.parse(data) as unknown as InfoPlist;
        } catch (error) {
            vscode.window.showWarningMessage(`Unable to parse ${platformManifest}: ${error}`);
            return undefined;
        }
        const plistKey = type === "XCTest" ? "XCTEST_VERSION" : "SWIFT_TESTING_VERSION";
        const version = infoPlist.DefaultProperties[plistKey];
        if (!version) {
            new SwiftOutputChannel("swift").appendLine(
                `Warning: ${platformManifest} is missing the ${plistKey} key.`
            );
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
    private static async getSwiftTargetInfo(): Promise<SwiftTargetInfo> {
        try {
            try {
                const { stdout } = await execSwift(["-print-target-info"], "default");
                const targetInfo = JSON.parse(stdout.trimEnd()) as SwiftTargetInfo;
                if (targetInfo.compilerVersion) {
                    return targetInfo;
                }
            } catch {
                // hit error while running `swift -print-target-info`. We are possibly running
                // a version of swift 5.3 or older
            }
            const { stdout } = await execSwift(["--version"], "default");
            return {
                compilerVersion: stdout.split("\n", 1)[0],
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
    private static getSwiftVersion(targetInfo: SwiftTargetInfo): Version {
        const match = targetInfo.compilerVersion.match(/Swift version ([\S]+)/);
        let version: Version | undefined;
        if (match) {
            version = Version.fromString(match[1]);
        }
        return version ?? new Version(0, 0, 0);
    }

    /**
     * Check if a file exists.
     * @returns true if the file exists at the supplied path
     */
    private static async fileExists(path: string): Promise<boolean> {
        try {
            await fs.access(path, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    }
}
