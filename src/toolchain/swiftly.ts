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
import { SwiftlyConfig } from "./ToolchainVersion";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as os from "os";
import * as readline from "readline";
import * as Stream from "stream";
import { execFile, ExecFileError, execFileStreamOutput } from "../utilities/utilities";
import * as vscode from "vscode";
import { Version } from "../utilities/version";
import { z } from "zod/v4/mini";
import { SwiftLogger } from "../logging/SwiftLogger";
import { findBinaryPath } from "../utilities/shell";
import { downloadFile } from "../utilities/utilities";

const ListResult = z.object({
    toolchains: z.array(
        z.object({
            inUse: z.boolean(),
            isDefault: z.boolean(),
            version: z.discriminatedUnion("type", [
                z.object({
                    major: z.union([z.number(), z.undefined()]),
                    minor: z.union([z.number(), z.undefined()]),
                    patch: z.union([z.number(), z.undefined()]),
                    name: z.string(),
                    type: z.literal("stable"),
                }),
                z.object({
                    major: z.union([z.number(), z.undefined()]),
                    minor: z.union([z.number(), z.undefined()]),
                    branch: z.string(),
                    date: z.string(),
                    name: z.string(),
                    type: z.literal("snapshot"),
                }),
            ]),
        })
    ),
});

const InUseVersionResult = z.object({
    version: z.string(),
});

const StableVersion = z.object({
    major: z.number(),
    minor: z.number(),
    patch: z.number(),
    name: z.string(),
    type: z.literal("stable"),
});

export type StableVersion = z.infer<typeof StableVersion>;

const SnapshotVersion = z.object({
    major: z.number(),
    minor: z.number(),
    branch: z.string(),
    date: z.string(),
    name: z.string(),
    type: z.literal("snapshot"),
});

export type SnapshotVersion = z.infer<typeof SnapshotVersion>;

const AvailableToolchain = z.object({
    inUse: z.boolean(),
    installed: z.boolean(),
    isDefault: z.boolean(),
    version: z.discriminatedUnion("type", [StableVersion, SnapshotVersion]),
});

export function isStableVersion(
    version: StableVersion | SnapshotVersion
): version is StableVersion {
    return version.type === "stable";
}

export function isSnapshotVersion(
    version: StableVersion | SnapshotVersion
): version is SnapshotVersion {
    return version.type === "snapshot";
}

const ListAvailableResult = z.object({
    toolchains: z.array(AvailableToolchain),
});
export type AvailableToolchain = z.infer<typeof AvailableToolchain>;

export interface SwiftlyProgressData {
    step?: {
        text?: string;
        timestamp?: number;
        percent?: number;
    };
}

export interface PostInstallValidationResult {
    isValid: boolean;
    summary: string;
    invalidCommands?: string[];
}

export class Swiftly {
    /**
     * Finds the version of Swiftly installed on the system.
     *
     * @returns the version of Swiftly as a `Version` object, or `undefined`
     * if Swiftly is not installed or not supported.
     */
    public static async version(logger?: SwiftLogger): Promise<Version | undefined> {
        if (!Swiftly.isSupported()) {
            return undefined;
        }
        try {
            const { stdout } = await execFile("swiftly", ["--version"]);
            return Version.fromString(stdout.trim());
        } catch (error) {
            logger?.error(`Failed to retrieve Swiftly version: ${error}`);
            return undefined;
        }
    }

    /**
     * Checks if the installed version of Swiftly supports JSON output.
     *
     * @returns `true` if JSON output is supported, `false` otherwise.
     */
    private static async supportsJsonOutput(logger?: SwiftLogger): Promise<boolean> {
        if (!Swiftly.isSupported()) {
            return false;
        }
        try {
            const { stdout } = await execFile("swiftly", ["--version"]);
            const version = Version.fromString(stdout.trim());
            return version?.isGreaterThanOrEqual(new Version(1, 1, 0)) ?? false;
        } catch (error) {
            logger?.error(`Failed to check Swiftly JSON support: ${error}`);
            return false;
        }
    }

    /**
     * Finds the list of toolchains managed by Swiftly.
     *
     * @returns an array of toolchain paths
     */
    public static async listAvailableToolchains(logger?: SwiftLogger): Promise<string[]> {
        if (!this.isSupported()) {
            return [];
        }
        const version = await Swiftly.version(logger);
        if (!version) {
            logger?.warn("Swiftly is not installed");
            return [];
        }

        if (!(await Swiftly.supportsJsonOutput(logger))) {
            return await Swiftly.getToolchainInstallLegacy(logger);
        }

        return await Swiftly.getListAvailableToolchains(logger);
    }

    private static async getListAvailableToolchains(logger?: SwiftLogger): Promise<string[]> {
        try {
            const { stdout } = await execFile("swiftly", ["list", "--format=json"]);
            const response = ListResult.parse(JSON.parse(stdout));
            return response.toolchains.map(t => t.version.name);
        } catch (error) {
            logger?.error(`Failed to retrieve Swiftly installations: ${error}`);
            return [];
        }
    }

    private static async getToolchainInstallLegacy(logger?: SwiftLogger) {
        try {
            const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
            if (!swiftlyHomeDir) {
                return [];
            }
            const swiftlyConfig = await Swiftly.getConfig();
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
            logger?.error(`Failed to retrieve Swiftly installations: ${error}`);
            throw new Error(
                `Failed to retrieve Swiftly installations from disk: ${(error as Error).message}`
            );
        }
    }

    public static isSupported() {
        return process.platform === "linux" || process.platform === "darwin";
    }

    public static async inUseLocation(swiftlyPath: string = "swiftly", cwd?: vscode.Uri) {
        const { stdout: inUse } = await execFile(swiftlyPath, ["use", "--print-location"], {
            cwd: cwd?.fsPath,
        });
        return inUse.trimEnd();
    }

    public static async inUseVersion(
        swiftlyPath: string = "swiftly",
        cwd?: vscode.Uri
    ): Promise<string | undefined> {
        if (!this.isSupported()) {
            throw new Error("Swiftly is not supported on this platform");
        }

        if (!(await Swiftly.supportsJsonOutput())) {
            return undefined;
        }

        const { stdout } = await execFile(swiftlyPath, ["use", "--format=json"], {
            cwd: cwd?.fsPath,
        });
        const result = InUseVersionResult.parse(JSON.parse(stdout));
        return result.version;
    }

    public static async use(version: string): Promise<void> {
        if (!this.isSupported()) {
            throw new Error("Swiftly is not supported on this platform");
        }
        await execFile("swiftly", ["use", version]);
    }

    /**
     * Determine if Swiftly is being used to manage the active toolchain and if so, return
     * the path to the active toolchain.
     * @returns The location of the active toolchain if swiftly is being used to manage it.
     */
    public static async toolchain(
        logger?: SwiftLogger,
        cwd?: vscode.Uri
    ): Promise<string | undefined> {
        const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
        if (swiftlyHomeDir) {
            const { stdout: swiftLocation } = await execFile("which", ["swift"]);
            if (swiftLocation.startsWith(swiftlyHomeDir)) {
                // Print the location of the toolchain that swiftly is using. If there
                // is no cwd specified then it returns the global "inUse" toolchain otherwise
                // it respects the .swift-version file in the cwd and resolves using that.
                try {
                    const inUse = await Swiftly.inUseLocation("swiftly", cwd);
                    if (inUse.length > 0) {
                        return path.join(inUse, "usr");
                    }
                } catch (err: unknown) {
                    logger?.error(`Failed to retrieve Swiftly installations: ${err}`);
                    const error = err as ExecFileError;
                    // Its possible the toolchain in .swift-version is misconfigured or doesn't exist.
                    void vscode.window.showErrorMessage(
                        `Failed to load toolchain from Swiftly: ${error.stderr}`
                    );
                }
            }
        }
        return undefined;
    }

    /**
     * Lists all toolchains available for installation from swiftly
     *
     * @param branch Optional branch to filter available toolchains (e.g., "main" for snapshots)
     * @param logger Optional logger for error reporting
     * @returns Array of available toolchains
     */
    public static async listAvailable(
        logger?: SwiftLogger,
        branch?: string
    ): Promise<AvailableToolchain[]> {
        if (!this.isSupported()) {
            return [];
        }

        const version = await Swiftly.version(logger);
        if (!version) {
            logger?.warn("Swiftly is not installed");
            return [];
        }

        if (!(await Swiftly.supportsJsonOutput(logger))) {
            logger?.info("Using legacy text parsing for older Swiftly version");
            return await this.listAvailableLegacy(logger, branch);
        }

        try {
            const args = ["list-available", "--format=json"];
            if (branch) {
                args.push(branch);
            }
            const { stdout: availableStdout } = await execFile("swiftly", args);
            return ListAvailableResult.parse(JSON.parse(availableStdout)).toolchains;
        } catch (error) {
            logger?.error(`Failed to retrieve available Swiftly toolchains: ${error}`);
            return [];
        }
    }

    /**
     * Legacy method to parse plain text output from older Swiftly versions
     *
     * @param logger Optional logger for error reporting
     * @param branch Optional branch to filter available toolchains
     * @returns Array of available toolchains parsed from text output
     */
    private static async listAvailableLegacy(
        logger?: SwiftLogger,
        branch?: string
    ): Promise<AvailableToolchain[]> {
        try {
            const args = ["list-available"];
            if (branch) {
                args.push(branch);
            }
            const { stdout } = await execFile("swiftly", args);

            // Get list of installed toolchains to mark them as installed
            const installedToolchains = new Set(await this.listAvailableToolchains(logger));

            // Parse the text output
            const toolchains: AvailableToolchain[] = [];
            const lines = stdout.split("\n");

            for (const line of lines) {
                const trimmedLine = line.trim();

                // Skip headers and empty lines
                if (
                    !trimmedLine ||
                    trimmedLine.startsWith("Available") ||
                    trimmedLine.startsWith("---")
                ) {
                    continue;
                }

                // Parse Swift version line (e.g., "Swift 6.1.2 (installed) (in use) (default)")
                const match = trimmedLine.match(/^Swift\s+(\d+\.\d+(?:\.\d+)?)/);
                if (match) {
                    const versionString = match[1];
                    const fullLine = trimmedLine;

                    // Check if this toolchain is installed, in use, or default
                    const installed =
                        installedToolchains.has(versionString) || fullLine.includes("(installed)");
                    const inUse = fullLine.includes("(in use)");
                    const isDefault = fullLine.includes("(default)");

                    // Parse version components
                    const versionParts = versionString.split(".").map(Number);
                    const major = versionParts[0] || 0;
                    const minor = versionParts[1] || 0;
                    const patch = versionParts[2] || 0;

                    toolchains.push({
                        inUse,
                        installed,
                        isDefault,
                        version: {
                            type: "stable",
                            major,
                            minor,
                            patch,
                            name: versionString,
                        },
                    });
                }
            }

            return toolchains;
        } catch (error) {
            logger?.error(`Failed to retrieve available toolchains using legacy parsing: ${error}`);
            return [];
        }
    }

    /**
     * Installs a toolchain via swiftly with optional progress tracking
     *
     * @param version The toolchain version to install
     * @param progressCallback Optional callback that receives progress data as JSON objects
     * @param logger Optional logger for error reporting
     */
    public static async installToolchain(
        version: string,
        progressCallback?: (progressData: SwiftlyProgressData) => void,
        logger?: SwiftLogger
    ): Promise<void> {
        if (!this.isSupported()) {
            throw new Error("Swiftly is not supported on this platform");
        }

        logger?.info(`Installing toolchain ${version} via swiftly`);

        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-swift-"));
        const postInstallFilePath = path.join(tmpDir, `post-install-${version}.sh`);

        // Check if Swiftly version supports --progress-file option (requires version >= 1.1.0)
        const swiftlyVersion = await this.version(logger);
        const supportsProgressFile =
            swiftlyVersion?.isGreaterThanOrEqual(new Version(1, 1, 0)) ?? false;

        let progressPipePath: string | undefined;
        let progressPromise: Promise<void> | undefined;

        if (progressCallback && supportsProgressFile) {
            progressPipePath = path.join(tmpDir, `progress-${version}.pipe`);

            await execFile("mkfifo", [progressPipePath]);

            progressPromise = new Promise<void>((resolve, reject) => {
                const rl = readline.createInterface({
                    input: fsSync.createReadStream(progressPipePath!),
                    crlfDelay: Infinity,
                });

                rl.on("line", (line: string) => {
                    try {
                        const progressData = JSON.parse(line.trim()) as SwiftlyProgressData;
                        progressCallback(progressData);
                    } catch (err) {
                        logger?.error(`Failed to parse progress line: ${err}`);
                    }
                });

                rl.on("close", () => {
                    resolve();
                });

                rl.on("error", err => {
                    reject(err);
                });
            });
        }

        const installArgs = [
            "install",
            version,
            "--use",
            "--assume-yes",
            "--post-install-file",
            postInstallFilePath,
        ];

        // Only add --progress-file if the Swiftly version supports it
        if (progressPipePath && supportsProgressFile) {
            installArgs.push("--progress-file", progressPipePath);
        }

        try {
            logger?.info(`Running swiftly with args: ${installArgs.join(" ")}`);
            const installPromise = execFile("swiftly", installArgs);

            if (progressPromise) {
                await Promise.all([installPromise, progressPromise]);
            } else {
                await installPromise;
            }

            if (process.platform === "linux") {
                await this.handlePostInstallFile(postInstallFilePath, version, logger);
            }

            logger?.info(`Successfully installed Swift toolchain ${version}`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger?.error(`Failed to install Swift toolchain ${version}: ${errorMsg}`);

            // Show user-friendly error message
            void vscode.window.showErrorMessage(
                `Failed to install Swift ${version}: ${errorMsg}. Please check the output channel for details.`
            );

            throw error;
        } finally {
            // Clean up temporary files
            const cleanup = async () => {
                if (progressPipePath) {
                    try {
                        await fs.unlink(progressPipePath);
                        logger?.debug(`Cleaned up progress pipe: ${progressPipePath}`);
                    } catch (cleanupError) {
                        logger?.debug(`Could not clean up progress pipe: ${cleanupError}`);
                    }
                }
                try {
                    await fs.unlink(postInstallFilePath);
                    logger?.debug(`Cleaned up post-install file: ${postInstallFilePath}`);
                } catch (cleanupError) {
                    logger?.debug(`Could not clean up post-install file: ${cleanupError}`);
                }
                try {
                    await fs.rmdir(tmpDir);
                    logger?.debug(`Cleaned up temp directory: ${tmpDir}`);
                } catch (cleanupError) {
                    logger?.debug(`Could not clean up temp directory: ${cleanupError}`);
                }
            };

            await cleanup();
        }
    }

    /**
     * Handles post-install file created by swiftly installation (Linux only)
     *
     * @param postInstallFilePath Path to the post-install script
     * @param version The toolchain version being installed
     * @param logger Optional logger for error reporting
     */
    private static async handlePostInstallFile(
        postInstallFilePath: string,
        version: string,
        logger?: SwiftLogger
    ): Promise<void> {
        try {
            await fs.access(postInstallFilePath);
        } catch {
            logger?.info(`No post-install steps required for toolchain ${version}`);
            return;
        }

        logger?.info(`Post-install file found for toolchain ${version}`);

        const validation = await this.validatePostInstallScript(postInstallFilePath, logger);

        if (!validation.isValid) {
            const errorMessage = `Post-install script contains unsafe commands. Invalid commands: ${validation.invalidCommands?.join(", ")}`;
            logger?.error(errorMessage);
            void vscode.window.showErrorMessage(
                `Installation of Swift ${version} requires additional system packages, but the post-install script contains commands that are not allowed for security reasons.`
            );
            return;
        }

        const shouldExecute = await this.showPostInstallConfirmation(version, validation, logger);

        if (shouldExecute) {
            await this.executePostInstallScript(postInstallFilePath, version, logger);
        } else {
            logger?.warn(`Swift ${version} post-install script execution cancelled by user`);
            void vscode.window.showWarningMessage(
                `Swift ${version} installation is incomplete. You may need to manually install additional system packages.`
            );
        }
    }

    /**
     * Validates post-install script commands against allow-list patterns.
     * Supports apt-get and yum package managers only.
     *
     * @param postInstallFilePath Path to the post-install script
     * @param logger Optional logger for error reporting
     * @returns Validation result with command summary
     */
    private static async validatePostInstallScript(
        postInstallFilePath: string,
        logger?: SwiftLogger
    ): Promise<PostInstallValidationResult> {
        try {
            const scriptContent = await fs.readFile(postInstallFilePath, "utf-8");
            const lines = scriptContent
                .split("\n")
                .filter(line => line.trim() && !line.trim().startsWith("#"));

            const allowedPatterns = [
                /^apt-get\s+-y\s+install(\s+[A-Za-z0-9\-_.+]+)+\s*$/, // apt-get -y install packages
                /^yum\s+install(\s+[A-Za-z0-9\-_.+]+)+\s*$/, // yum install packages
                /^\s*$|^#.*$/, // empty lines and comments
            ];

            const invalidCommands: string[] = [];
            const packageInstallCommands: string[] = [];

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) {
                    continue;
                }

                const isValid = allowedPatterns.some(pattern => pattern.test(trimmedLine));

                if (!isValid) {
                    invalidCommands.push(trimmedLine);
                } else if (trimmedLine.includes("install")) {
                    packageInstallCommands.push(trimmedLine);
                }
            }

            const isValid = invalidCommands.length === 0;

            let summary = "The script will perform the following actions:\n";
            if (packageInstallCommands.length > 0) {
                summary += `• Install system packages using package manager\n`;
                summary += `• Commands: ${packageInstallCommands.join("; ")}`;
            } else {
                summary += "• No package installations detected";
            }

            return {
                isValid,
                summary,
                invalidCommands: invalidCommands.length > 0 ? invalidCommands : undefined,
            };
        } catch (error) {
            logger?.error(`Failed to validate post-install script: ${error}`);
            return {
                isValid: false,
                summary: "Failed to read post-install script",
                invalidCommands: ["Unable to read script file"],
            };
        }
    }

    /**
     * Shows confirmation dialog to user for executing post-install script
     *
     * @param version The toolchain version being installed
     * @param validation The validation result
     * @param logger
     * @returns Promise resolving to user's decision
     */
    private static async showPostInstallConfirmation(
        version: string,
        validation: PostInstallValidationResult,
        logger?: SwiftLogger
    ): Promise<boolean> {
        const summaryLines = validation.summary.split("\n");
        const firstTwoLines = summaryLines.slice(0, 2).join("\n");

        const message =
            `Swift ${version} installation requires additional system packages to be installed. ` +
            `This will require administrator privileges.\n\n${firstTwoLines}\n\n` +
            `Do you want to proceed with running the post-install script?`;

        logger?.warn(
            `User confirmation required to execute post-install script for Swift ${version} installation,
            this requires ${firstTwoLines} permissions.`
        );
        const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            "Execute Script",
            "Cancel"
        );

        return choice === "Execute Script";
    }

    /**
     * Executes post-install script with elevated permissions (Linux only)
     *
     * @param postInstallFilePath Path to the post-install script
     * @param version The toolchain version being installed
     * @param logger Optional logger for error reporting
     */
    private static async executePostInstallScript(
        postInstallFilePath: string,
        version: string,
        logger?: SwiftLogger
    ): Promise<void> {
        logger?.info(`Executing post-install script for toolchain ${version}`);

        const outputChannel = vscode.window.createOutputChannel(`Swift ${version} Post-Install`);

        try {
            outputChannel.show(true);
            outputChannel.appendLine(`Executing post-install script for Swift ${version}...`);
            outputChannel.appendLine(`Script location: ${postInstallFilePath}`);
            outputChannel.appendLine("");

            await execFile("chmod", ["+x", postInstallFilePath]);

            const command = "pkexec";
            const args = [postInstallFilePath];

            outputChannel.appendLine(`Executing: ${command} ${args.join(" ")}`);
            outputChannel.appendLine("");

            const outputStream = new Stream.Writable({
                write(chunk, _encoding, callback) {
                    const text = chunk.toString();
                    outputChannel.append(text);
                    callback();
                },
            });

            await execFileStreamOutput(command, args, outputStream, outputStream, null, {});

            outputChannel.appendLine("");
            outputChannel.appendLine(
                `Post-install script completed successfully for Swift ${version}`
            );

            void vscode.window.showInformationMessage(
                `Swift ${version} post-install script executed successfully. Additional system packages have been installed.`
            );
        } catch (error) {
            const errorMsg = `Failed to execute post-install script: ${error}`;
            logger?.error(errorMsg);
            outputChannel.appendLine("");
            outputChannel.appendLine(`Error: ${errorMsg}`);

            void vscode.window.showErrorMessage(
                `Failed to execute post-install script for Swift ${version}. Check the output channel for details.`
            );
        }
    }

    /**
     * Reads the Swiftly configuration file, if it exists.
     *
     * @returns A parsed Swiftly configuration.
     */
    private static async getConfig(): Promise<SwiftlyConfig | undefined> {
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

    public static async isInstalled(): Promise<boolean> {
        if (!this.isSupported()) {
            return false;
        }
        try {
            await findBinaryPath("swiftly");
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Detects if Swiftly is missing by attempting to run swiftly --version
     *
     * @param logger Optional logger for error reporting
     * @returns true if Swiftly is missing (error code 127), false otherwise
     */
    public static async isMissing(logger?: SwiftLogger): Promise<boolean> {
        if (!this.isSupported()) {
            return false;
        }
        try {
            await execFile("swiftly", ["--version"]);
            return false;
        } catch (error: unknown) {
            if ((error as { code?: number }).code === 127) {
                logger?.warn("Swiftly not found (error code 127)");
                return true;
            }
            logger?.error(`Error checking Swiftly: ${error}`);
            return false;
        }
    }

    /**
     * Gets the install URL for automated Swiftly installation based on platform
     *
     * @returns The install URL
     */
    public static getInstallUrl(): string {
        if (process.platform === "linux") {
            // Determine architecture dynamically
            const arch = process.arch === "arm64" ? "arm64" : "x86_64";
            return `https://download.swift.org/swiftly/linux/swiftly-${arch}.tar.gz`;
        } else if (process.platform === "darwin") {
            return "https://download.swift.org/swiftly/darwin/swiftly.pkg";
        }
        throw new Error(`Unsupported platform: ${process.platform}`);
    }

    /**
     * Installs Swiftly automatically using the official installation method
     *
     * @param logger Optional logger for error reporting
     * @returns Promise that resolves when installation is complete
     */
    public static async installSwiftly(logger?: SwiftLogger): Promise<void> {
        if (!this.isSupported()) {
            throw new Error("Swiftly is not supported on this platform");
        }

        logger?.info("Starting Swiftly installation using official method");

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Installing Swiftly",
                cancellable: false,
            },
            async progress => {
                let tmpDir: string | undefined;
                try {
                    progress.report({ increment: 10, message: "Downloading Swiftly..." });

                    const installUrl = this.getInstallUrl();
                    logger?.info(`Install URL: ${installUrl}`);

                    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-swift-swiftly-"));
                    const filename = path.basename(installUrl);
                    const downloadPath = path.join(tmpDir, filename);

                    await downloadFile(installUrl, downloadPath);

                    progress.report({ increment: 30, message: "Installing Swiftly..." });

                    const outputChannel = vscode.window.createOutputChannel("Swiftly Installation");
                    outputChannel.show(true);
                    outputChannel.appendLine("Installing Swiftly...");
                    outputChannel.appendLine("");

                    const outputStream = new Stream.Writable({
                        write(chunk, _encoding, callback) {
                            const text = chunk.toString();
                            outputChannel.append(text);
                            callback();
                        },
                    });

                    if (process.platform === "linux") {
                        // Extract tar.gz file
                        await execFileStreamOutput(
                            "tar",
                            ["-zxf", downloadPath, "-C", tmpDir],
                            outputStream,
                            outputStream,
                            null,
                            {}
                        );

                        // Move binary to appropriate location
                        const binDir = path.join(os.homedir(), ".local", "bin");
                        await fs.mkdir(binDir, { recursive: true });
                        const swiftlyBin = path.join(tmpDir, "swiftly");
                        const targetPath = path.join(binDir, "swiftly");
                        await fs.copyFile(swiftlyBin, targetPath);
                        await fs.chmod(targetPath, 0o755);

                        outputChannel.appendLine(`Swiftly binary installed to ${targetPath}`);
                    } else if (process.platform === "darwin") {
                        // Install pkg file
                        await execFileStreamOutput(
                            "installer",
                            ["-pkg", downloadPath, "-target", "CurrentUserHomeDirectory"],
                            outputStream,
                            outputStream,
                            null,
                            {}
                        );
                        outputChannel.appendLine("Swiftly pkg installer completed");
                    }

                    progress.report({ increment: 30, message: "Initializing Swiftly..." });

                    // Run swiftly init
                    await this.initializeSwiftly(logger);

                    progress.report({ increment: 20, message: "Installation complete!" });

                    outputChannel.appendLine("");
                    outputChannel.appendLine("Swiftly installation completed successfully");

                    // Clean up temp directory
                    await fs.rm(tmpDir, { recursive: true, force: true });

                    logger?.info("Swiftly installation completed successfully");
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    logger?.error(`Swiftly installation failed: ${errorMsg}`);

                    // Show user-friendly error message
                    void vscode.window.showErrorMessage(
                        `Failed to install Swiftly: ${errorMsg}. Please check the output channel for details.`
                    );

                    // Clean up temp directory on error
                    try {
                        if (tmpDir) {
                            await fs.rm(tmpDir, { recursive: true, force: true });
                        }
                    } catch (cleanupError) {
                        logger?.error(`Failed to clean up temp directory: ${cleanupError}`);
                    }

                    throw error;
                }
            }
        );
    }

    /**
     * Initializes Swiftly after installation
     *
     * @param logger Optional logger for error reporting
     */
    private static async initializeSwiftly(logger?: SwiftLogger): Promise<void> {
        logger?.info("Initializing Swiftly");

        const outputChannel = vscode.window.createOutputChannel("Swiftly Initialization");
        outputChannel.show(true);
        outputChannel.appendLine("Initializing Swiftly...");

        try {
            // Determine the swiftly binary path based on platform
            let swiftlyPath: string;
            if (process.platform === "linux") {
                const binDir = path.join(os.homedir(), ".local", "bin");
                swiftlyPath = path.join(binDir, "swiftly");
            } else if (process.platform === "darwin") {
                const homeDir = path.join(os.homedir(), ".swiftly");
                swiftlyPath = path.join(homeDir, "bin", "swiftly");
            } else {
                throw new Error(`Unsupported platform: ${process.platform}`);
            }

            const { stdout, stderr } = await execFile(swiftlyPath, [
                "init",
                "--verbose",
                "--assume-yes",
                "--skip-install",
            ]);

            outputChannel.appendLine(stdout);
            if (stderr) {
                outputChannel.appendLine("Stderr:");
                outputChannel.appendLine(stderr);
            }

            outputChannel.appendLine("Swiftly initialization completed successfully");
        } catch (error) {
            logger?.error(`Failed to initialize Swiftly: ${error}`);
            outputChannel.appendLine(`Error: ${error}`);
            throw error;
        }
    }

    /**
     * Installs Swift toolchain using Swiftly after it has been installed
     *
     * @param version The Swift version to install (defaults to "latest")
     * @param logger Optional logger for error reporting
     */
    public static async installSwiftWithSwiftly(
        version: string = "latest",
        logger?: SwiftLogger
    ): Promise<void> {
        logger?.info(`Installing Swift ${version} using Swiftly`);

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Installing Swift ${version}`,
                cancellable: false,
            },
            async progress => {
                try {
                    progress.report({ increment: 10, message: "Preparing installation..." });

                    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-swift-"));
                    progress.report({ increment: 10, message: `Installing Swift ${version}...` });

                    let lastProgressTime = Date.now();
                    let totalProgress = 20; // Already used 20% for preparation

                    await this.installToolchain(
                        version,
                        progressData => {
                            const now = Date.now();
                            // Only update progress every 2 seconds to avoid too frequent updates
                            if (progressData.step?.text && now - lastProgressTime > 2000) {
                                const remainingProgress = 70; // Leave 10% for completion
                                const incrementAmount = progressData.step.percent
                                    ? Math.min(progressData.step.percent / 10, 5)
                                    : Math.min(remainingProgress - totalProgress, 5);

                                if (totalProgress < 70) {
                                    totalProgress += incrementAmount;
                                    progress.report({
                                        increment: incrementAmount,
                                        message: progressData.step.text,
                                    });
                                    lastProgressTime = now;
                                }
                            }
                        },
                        logger
                    );

                    progress.report({
                        increment: 100 - totalProgress,
                        message: "Installation complete!",
                    });

                    // Clean up temp directory
                    await fs.rm(tmpDir, { recursive: true, force: true });
                } catch (error) {
                    logger?.error(`Failed to install Swift ${version}: ${error}`);
                    throw error;
                }
            }
        );
    }

    /**
     * Shows a prompt to install Swiftly and handles the user's choice
     *
     * @param logger Optional logger for error reporting
     * @returns Promise that resolves when the user makes a choice
     */
    public static async promptInstallSwiftly(logger?: SwiftLogger): Promise<void> {
        const message =
            "Swiftly (Swift toolchain manager) is not installed. Would you like to install it automatically? This will allow you to easily manage Swift versions.";

        const choice = await vscode.window.showInformationMessage(
            message,
            { modal: true },
            "Install Swiftly",
            "Cancel"
        );

        if (choice === "Install Swiftly") {
            try {
                await this.installSwiftly(logger);
                await this.installSwiftWithSwiftly("latest", logger);

                void vscode.window.showInformationMessage(
                    "Swiftly and Swift have been installed successfully! Please restart any terminal windows to use the new toolchain."
                );

                // Prompt to restart extension
                const restartChoice = await vscode.window.showInformationMessage(
                    "The Swift extension should be reloaded to use the new toolchain.",
                    "Reload Extension",
                    "Later"
                );

                if (restartChoice === "Reload Extension") {
                    await vscode.commands.executeCommand("workbench.action.reloadWindow");
                }
            } catch (error) {
                logger?.error(`Failed to install Swiftly: ${error}`);
                void vscode.window.showErrorMessage(
                    `Failed to install Swiftly: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
        // If "Cancel" or no choice, do nothing
    }
}
