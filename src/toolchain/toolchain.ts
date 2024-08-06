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
import { execFile, execSwift, expandFilePathTilda, pathExists } from "../utilities/utilities";
import { Version } from "../utilities/version";
import { BuildFlags } from "./BuildFlags";
import { Sanitizer } from "./Sanitizer";

/**
 * Contents of **Info.plist** on Windows.
 */
interface InfoPlist {
    DefaultProperties: {
        XCTEST_VERSION: string | undefined;
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
    constructor(
        public swiftFolderPath: string, // folder swift executable in $PATH was found in
        public toolchainPath: string, // toolchain folder. One folder up from swift bin folder. This is to support toolchains without usr folder
        public swiftVersionString: string, // Swift version as a string, including description
        public swiftVersion: Version, // Swift version as semVar variable
        public runtimePath?: string, // runtime library included in output from `swift -print-target-info`
        private defaultTarget?: string,
        public defaultSDK?: string,
        public customSDK?: string,
        public xcTestPath?: string,
        public swiftPMTestingHelperPath?: string
    ) {}

    static async create(): Promise<SwiftToolchain> {
        const swiftFolderPath = await this.getSwiftFolderPath();
        const toolchainPath = await this.getToolchainPath(swiftFolderPath);
        const targetInfo = await this.getSwiftTargetInfo();
        const swiftVersion = await this.getSwiftVersion(targetInfo);
        const runtimePath = await this.getRuntimePath(targetInfo);
        const defaultSDK = await this.getDefaultSDK();
        const customSDK = this.getCustomSDK();
        const xcTestPath = await this.getXCTestPath(
            targetInfo,
            swiftFolderPath,
            swiftVersion,
            runtimePath,
            customSDK ?? defaultSDK
        );
        const swiftPMTestingHelperPath = await this.getSwiftPMTestingHelperPath(toolchainPath);

        return new SwiftToolchain(
            swiftFolderPath,
            toolchainPath,
            targetInfo.compilerVersion,
            swiftVersion,
            runtimePath,
            targetInfo.target?.triple,
            defaultSDK,
            customSDK,
            xcTestPath,
            swiftPMTestingHelperPath
        );
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
        return xcodes.trimEnd().split("\n");
    }

    /**
     * Reads the swiftly configuration file to find a list of installed toolchains.
     *
     * @returns an array of toolchain paths
     */
    public static async getSwiftlyToolchainInstalls(): Promise<string[]> {
        // Swiftly is only available on Linux right now
        if (process.platform !== "linux") {
            return [];
        }
        try {
            const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
            if (!swiftlyHomeDir) {
                return [];
            }
            const swiftlyConfigRaw = await fs.readFile(
                path.join(swiftlyHomeDir, "config.json"),
                "utf-8"
            );
            const swiftlyConfig: unknown = JSON.parse(swiftlyConfigRaw);
            if (!(swiftlyConfig instanceof Object) || !("installedToolchains" in swiftlyConfig)) {
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
     * Checks common directories for available swift toolchain installations.
     *
     * @returns an array of toolchain paths
     */
    public static async getToolchainInstalls(): Promise<string[]> {
        if (process.platform !== "darwin") {
            return [];
        }
        return Promise.all([
            this.findToolchainsIn("/Library/Developer/Toolchains/"),
            this.findToolchainsIn(path.join(os.homedir(), "Library/Developer/Toolchains/")),
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
     * Return fullpath for toolchain executable
     */
    public getToolchainExecutable(exe: string): string {
        // should we add `.exe` at the end of the executable name
        const windowsExeSuffix = process.platform === "win32" ? ".exe" : "";
        return `${this.toolchainPath}/bin/${exe}${windowsExeSuffix}`;
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
     * Cannot use `getToolchainExecutable` to get the LLDB executable as LLDB
     * is not in macOS toolchain path
     */
    public async getLLDB(): Promise<string> {
        let lldbPath = path.join(
            this.swiftFolderPath,
            process.platform === "win32" ? "lldb.exe" : "lldb"
        );
        if (!(await pathExists(lldbPath))) {
            if (process.platform !== "darwin") {
                throw new Error("Failed to find LLDB in swift toolchain");
            }
            const xcodeDirectory = SwiftToolchain.getXcodeDirectory(this.swiftFolderPath);
            if (!xcodeDirectory) {
                throw new Error("Failed to find LLDB in swift toolchain");
            }
            const { stdout } = await execFile("xcrun", ["-find", "lldb"], {
                env: { ...process.env, DEVELOPER_DIR: xcodeDirectory },
            });
            lldbPath = stdout.trimEnd();
        }
        return lldbPath;
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
        const base = this.basePlatformDeveloperPath();
        if (!base) {
            return undefined;
        }
        return path.join(base, "usr/lib");
    }

    /**
     * Framework path for swift-testing executables
     */
    public swiftTestingFrameworkPath(): string | undefined {
        const base = this.basePlatformDeveloperPath();
        if (!base) {
            return undefined;
        }
        return path.join(base, "Library/Frameworks");
    }

    get diagnostics(): string {
        let str = "";
        str += this.swiftVersionString;
        str += `\nSwift Path: ${this.swiftFolderPath}`;
        str += `\nToolchain Path: ${this.toolchainPath}`;
        if (this.runtimePath) {
            str += `\nRuntime Library Path: ${this.runtimePath}`;
        }
        if (this.defaultTarget) {
            str += `\nDefault Target: ${this.defaultTarget}`;
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
            const swiftPath = expandFilePathTilda(path.dirname(realSwift));
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
                // look up runtime library directory for XCTest alternatively
                const fallbackPath =
                    runtimePath !== undefined &&
                    (await pathExists(path.join(runtimePath, "XCTest.dll")))
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
                        "XCTest not found due to non-standardized library layout. Tests explorer won't work as expected."
                    );
                    return undefined;
                }
                const data = await fs.readFile(platformManifest, "utf8");
                let infoPlist;
                try {
                    infoPlist = plist.parse(data) as unknown as InfoPlist;
                } catch (error) {
                    vscode.window.showWarningMessage(
                        `Unable to parse ${platformManifest}: ${error}`
                    );
                    return undefined;
                }
                const version = infoPlist.DefaultProperties.XCTEST_VERSION;
                if (!version) {
                    throw Error("Info.plist is missing the XCTEST_VERSION key.");
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
                        `XCTest-${version}`,
                        "usr",
                        bindir
                    );
                } else {
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
        }
        return undefined;
    }

    /** @returns swift target info */
    private static async getSwiftTargetInfo(): Promise<SwiftTargetInfo> {
        try {
            try {
                const { stdout } = await execSwift(
                    ["-print-target-info", ...BuildFlags.disableSandboxFlags()],
                    "default"
                );
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
