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
import * as os from "os";
import * as path from "path";
import * as plist from "plist";
import * as vscode from "vscode";

import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { expandFilePathTilde, fileExists, pathExists } from "../utilities/filesystem";
import { findBinaryInPath } from "../utilities/shell";
import { lineBreakRegex } from "../utilities/tasks";
import { execFile, execSwift } from "../utilities/utilities";
import { Version } from "../utilities/version";
import { BuildFlags } from "./BuildFlags";
import { Sanitizer } from "./Sanitizer";
import { Swiftly } from "./swiftly";

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

/**
 * Different entities which are used to manage toolchain installations. Possible values are:
 *  - `xcrun`: An Xcode/CommandLineTools toolchain controlled via the `xcrun` and `xcode-select` utilities on macOS.
 *  - `swiftly`: A toolchain managed by `swiftly`.
 *  - `swiftenv`: A toolchain managed by `swiftenv`.
 *  - `unknown`: This toolchain was installed via a method unknown to the extension.
 */
export type ToolchainManager = "xcrun" | "swiftly" | "swiftenv" | "unknown";

export class SwiftToolchain {
    public swiftVersionString: string;

    constructor(
        public manager: ToolchainManager,
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

    static async create(
        extensionRoot: string,
        folder?: vscode.Uri,
        logger?: SwiftLogger
    ): Promise<SwiftToolchain> {
        const swiftBinaryPath = await this.findSwiftBinaryInPath();
        const { toolchainPath, toolchainManager } = await this.getToolchainPath(
            swiftBinaryPath,
            extensionRoot,
            folder,
            logger
        );
        const targetInfo = await this.getSwiftTargetInfo(
            this._getToolchainExecutable(toolchainPath, "swift"),
            logger
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
                toolchainPath,
                swiftVersion,
                runtimePath,
                customSDK ?? defaultSDK,
                logger
            ),
            this.getSwiftTestingPath(
                targetInfo,
                swiftVersion,
                runtimePath,
                customSDK ?? defaultSDK,
                logger
            ),
            this.getSwiftPMTestingHelperPath(toolchainPath),
        ]);

        return new SwiftToolchain(
            toolchainManager,
            path.dirname(swiftBinaryPath),
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
     * Get the list of Xcode applications installed on macOS.
     *
     * Note: this uses a combination of xcode-select and the Spotlight index and may not contain
     * all Xcode installations depending on the user's macOS settings.
     *
     * @returns an array of Xcode installations in no particular order.
     */
    public static async findXcodeInstalls(): Promise<string[]> {
        if (process.platform !== "darwin") {
            return [];
        }

        // Use the Spotlight index and xcode-select to find available Xcode installations
        const [{ stdout: mdfindOutput }, xcodeDeveloperDir] = await Promise.all([
            execFile("mdfind", [`kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'`]),
            this.getXcodeDeveloperDir(),
        ]);
        const spotlightXcodes =
            mdfindOutput.length > 0 ? mdfindOutput.trimEnd().split(lineBreakRegex) : [];
        const selectedXcode = this.getXcodeDirectory(xcodeDeveloperDir);

        // Combine the results from both commands
        const result = spotlightXcodes;
        if (selectedXcode && spotlightXcodes.find(xcode => xcode === selectedXcode) === undefined) {
            result.push(selectedXcode);
        }
        return result;
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
        return SwiftToolchain._getToolchainExecutable(this.toolchainPath, executable);
    }

    private static _getToolchainExecutable(toolchainPath: string, executable: string): string {
        // should we add `.exe` at the end of the executable name
        const executableSuffix = process.platform === "win32" ? ".exe" : "";
        return path.join(toolchainPath, "bin", executable + executableSuffix);
    }

    /**
     * Returns the path to the Xcode application given a toolchain path. Returns undefined
     * if no application could be found.
     * @param toolchainPath The toolchain path.
     * @returns The path to the Xcode application or undefined if none.
     */
    private static getXcodeDirectory(toolchainPath: string): string | undefined {
        let xcodeDirectory = toolchainPath;
        while (path.extname(xcodeDirectory) !== ".app") {
            if (path.parse(xcodeDirectory).base === "") {
                return undefined;
            }
            xcodeDirectory = path.dirname(xcodeDirectory);
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
        return this.findToolchainExecutable("lldb");
    }

    /**
     * Returns the path to the LLDB debug adapter executable inside the selected
     * toolchain. If the user is on macOS and has no OSS toolchain selected, also
     * search inside Xcode.
     * @returns The path to the `lldb-dap` executable
     * @throws Throws an error if the executable cannot be found
     */
    public async getLLDBDebugAdapter(): Promise<string> {
        return this.findToolchainExecutable("lldb-dap");
    }

    /**
     * Search for the supplied executable in the toolchain.
     */
    private async findToolchainExecutable(executable: string): Promise<string> {
        let cause: unknown = undefined;
        try {
            if (process.platform === "win32") {
                executable += ".exe";
            }
            // First search the toolchain's 'bin' directory
            const toolchainExecutablePath = path.join(this.toolchainPath, "bin", executable);
            if (await pathExists(toolchainExecutablePath)) {
                return toolchainExecutablePath;
            }
            // Fallback to using xcrun if we're on macOS
            if (process.platform === "darwin") {
                const { stdout } = await execFile("xcrun", ["--find", executable]);
                return stdout.trim();
            }
        } catch (error) {
            cause = error;
        }
        throw new Error(`Failed to find ${executable} within Swift toolchain`, { cause });
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

    private static async findSwiftBinaryInPath(): Promise<string> {
        if (configuration.path !== "") {
            const pathFromSettings = expandFilePathTilde(configuration.path);
            const windowsExeSuffix = process.platform === "win32" ? ".exe" : "";

            return path.join(pathFromSettings, `swift${windowsExeSuffix}`);
        }
        return await findBinaryInPath("swift");
    }

    private static async isXcrunShim(binary: string, logger?: SwiftLogger): Promise<boolean> {
        if (!(await fileExists(binary))) {
            return false;
        }
        // Make sure that either Xcode or CommandLineTools are installed before attempting to run objdump.
        try {
            await execFile("xcode-select", ["-p"]);
        } catch (error) {
            logger?.error(error);
            return false;
        }
        // Use objdump to determine if this is an xcrun shim.
        try {
            const objdumpOutput = await execFile("xcrun", ["objdump", "-h", binary]);
            return objdumpOutput.stdout.includes("__xcrun_shim");
        } catch (error) {
            logger?.error(error);
            return false;
        }
    }

    /**
     * @returns path to Toolchain folder
     */
    private static async getToolchainPath(
        swiftBinaryPath: string,
        extensionRoot: string,
        cwd?: vscode.Uri,
        logger?: SwiftLogger
    ): Promise<{
        toolchainPath: string;
        toolchainManager: ToolchainManager;
    }> {
        try {
            // swift may be a symbolic link
            const realSwiftBinaryPath = await fs.realpath(swiftBinaryPath);
            // Check if the swift binary is managed by xcrun
            if (
                process.platform === "darwin" &&
                (await this.isXcrunShim(realSwiftBinaryPath, logger))
            ) {
                const { stdout } = await execFile("xcrun", ["--find", "swift"], {
                    env: configuration.swiftEnvironmentVariables,
                });
                return {
                    toolchainPath: path.resolve(stdout.trim(), "../../"),
                    toolchainManager: "xcrun",
                };
            }
            // Check if the swift binary is managed by swiftly
            if (await Swiftly.isManagedBySwiftly(swiftBinaryPath)) {
                const swiftlyToolchainPath = await Swiftly.getActiveToolchain(extensionRoot, cwd);
                return {
                    toolchainPath: path.resolve(swiftlyToolchainPath, "usr"),
                    toolchainManager: "swiftly",
                };
            }
            // Check if the swift binary is managed by swiftenv
            if (
                process.platform === "linux" &&
                realSwiftBinaryPath.endsWith(".swiftenv/shims/swift")
            ) {
                try {
                    const swiftenvPath = path.join(realSwiftBinaryPath, "../..");
                    const swiftenv = path.join(swiftenvPath, "libexec", "swiftenv");
                    const { stdout } = await execFile(swiftenv, ["which", "swift"]);
                    return {
                        toolchainPath: path.resolve(stdout.trim(), "../.."),
                        toolchainManager: "swiftenv",
                    };
                } catch (error) {
                    logger?.error(error);
                }
            }
            // Unable to determine who manages the swift toolchain.
            return {
                toolchainPath: path.resolve(realSwiftBinaryPath, "../.."),
                toolchainManager: "unknown",
            };
        } catch (error) {
            throw Error("Failed to find swift toolchain", { cause: error });
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
        sdkroot: string | undefined,
        logger?: SwiftLogger
    ): Promise<string | undefined> {
        if (process.platform !== "win32") {
            return undefined;
        }
        return this.getWindowsPlatformDLLPath(
            "Testing",
            targetInfo,
            swiftVersion,
            runtimePath,
            sdkroot,
            logger
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
        toolchainPath: string,
        swiftVersion: Version,
        runtimePath: string | undefined,
        sdkroot: string | undefined,
        logger?: SwiftLogger
    ): Promise<string | undefined> {
        switch (process.platform) {
            case "darwin": {
                const xcodeDirectory = this.getXcodeDirectory(toolchainPath);
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
                    sdkroot,
                    logger
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
        sdkroot: string | undefined,
        logger?: SwiftLogger
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
            void vscode.window.showWarningMessage(
                `${type} not found due to non-standardized library layout. Tests explorer won't work as expected.`
            );
            return undefined;
        }
        const data = await fs.readFile(platformManifest, "utf8");
        let infoPlist;
        try {
            infoPlist = plist.parse(data) as unknown as InfoPlist;
        } catch (error) {
            void vscode.window.showWarningMessage(`Unable to parse ${platformManifest}: ${error}`);
            return undefined;
        }
        const plistKey = type === "XCTest" ? "XCTEST_VERSION" : "SWIFT_TESTING_VERSION";
        const version = infoPlist.DefaultProperties[plistKey];
        if (!version) {
            logger?.warn(`${platformManifest} is missing the ${plistKey} key.`);
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
    private static async getSwiftTargetInfo(
        swiftExecutable: string,
        logger?: SwiftLogger
    ): Promise<SwiftTargetInfo> {
        try {
            try {
                const { stdout } = await execSwift(["-print-target-info"], { swiftExecutable });
                const targetInfo = JSON.parse(stdout.trimEnd()) as SwiftTargetInfo;
                if (!targetInfo.target) {
                    logger?.warn(
                        `No target found in toolchain, targetInfo was: ${JSON.stringify(targetInfo)}`
                    );
                }

                if (targetInfo.compilerVersion) {
                    return targetInfo;
                }
            } catch (error) {
                // hit error while running `swift -print-target-info`. We are possibly running
                // a version of swift 5.3 or older
                logger?.warn(`Error while running 'swift -print-target-info': ${error}`);
            }
            const { stdout } = await execSwift(["--version"], { swiftExecutable });
            return {
                compilerVersion: stdout.split(lineBreakRegex, 1)[0],
                paths: { runtimeLibraryPaths: [""] },
            };
        } catch (error) {
            logger?.warn(`Error while running 'swift --version': ${error}`);
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
