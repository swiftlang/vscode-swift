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
import { ExecFileOptions } from "child_process";
import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import * as Stream from "stream";
import { extract } from "tar";
import * as vscode from "vscode";
import { z } from "zod/v4/mini";

import { withAskpassServer } from "../askpass/askpass-server";
import { installSwiftlyToolchainWithProgress } from "../commands/installSwiftlyToolchain";
import { SwiftLogger } from "../logging/SwiftLogger";
import { showMissingToolchainDialog } from "../ui/ToolchainSelection";
import { touch } from "../utilities/filesystem";
import { findBinaryInPath } from "../utilities/shell";
import { ExecFileError, execFile, execFileStreamOutput } from "../utilities/utilities";
import { Version } from "../utilities/version";
import { SwiftlyConfig } from "./ToolchainVersion";

const SystemVersion = z.object({
    type: z.literal("system"),
    name: z.string(),
});
type SystemVersion = z.infer<typeof SystemVersion>;

const StableVersion = z.object({
    type: z.literal("stable"),
    name: z.string(),

    major: z.number(),
    minor: z.number(),
    patch: z.number(),
});
type StableVersion = z.infer<typeof StableVersion>;

const SnapshotVersion = z.object({
    type: z.literal("snapshot"),
    name: z.string(),

    major: z.optional(z.number()),
    minor: z.optional(z.number()),
    branch: z.string(),
    date: z.string(),
});
type SnapshotVersion = z.infer<typeof SnapshotVersion>;

type ToolchainVersion = SystemVersion | StableVersion | SnapshotVersion;

interface AvailableToolchain {
    inUse: boolean;
    installed: boolean;
    isDefault: boolean;
    version: ToolchainVersion;
}

interface InstalledToolchain {
    name: string;
    location?: string;
}

const SwiftlyListResult = z.object({
    toolchains: z.array(
        z.object({
            inUse: z.boolean(),
            isDefault: z.boolean(),
            // Older versions of swiftly do not have a `location` field.
            location: z.optional(z.string()),
            version: z.union([
                SystemVersion,
                StableVersion,
                SnapshotVersion,
                // Allow matching against unexpected future version types
                z.object(),
            ]),
        })
    ),
});

const SwiftlyListAvailableResult = z.object({
    toolchains: z.array(
        z.object({
            inUse: z.boolean(),
            installed: z.boolean(),
            isDefault: z.boolean(),
            version: z.union([
                SystemVersion,
                StableVersion,
                SnapshotVersion,
                // Allow matching against unexpected future version types
                z.object(),
            ]),
        })
    ),
});

const InUseVersionResult = z.object({
    version: z.string(),
});

const SwiftlyProgressData = z.object({
    complete: z.optional(
        z.object({
            success: z.boolean(),
        })
    ),
    step: z.optional(
        z.object({
            text: z.string(),
            percent: z.number(),
        })
    ),
});

export type SwiftlyProgressData = z.infer<typeof SwiftlyProgressData>;

interface PostInstallValidationResult {
    isValid: boolean;
    summary: string;
    invalidCommands?: string[];
}

interface MissingToolchainError {
    version: string;
    originalError: string;
}

/**
 * Parses Swiftly error message to detect missing toolchain scenarios
 * @param stderr The stderr output from swiftly command
 * @returns MissingToolchainError if this is a missing toolchain error, undefined otherwise
 */
export function parseSwiftlyMissingToolchainError(
    stderr: string
): MissingToolchainError | undefined {
    // Parse error message like: "uses toolchain version 6.1.2, but it doesn't match any of the installed toolchains"
    const versionMatch = stderr.match(/uses toolchain version ([0-9.]+(?:-[a-zA-Z0-9-]+)*)/);
    if (versionMatch && stderr.includes("doesn't match any of the installed toolchains")) {
        return {
            version: versionMatch[1],
            originalError: stderr,
        };
    }
    return undefined;
}

/**
 * Attempts to automatically install a missing Swiftly toolchain with user consent
 * @param version The toolchain version to install
 * @param logger Optional logger for error reporting
 * @param folder Optional folder context
 * @param token Optional cancellation token to abort the installation
 * @returns Promise<boolean> true if toolchain was successfully installed, false otherwise
 */
export async function handleMissingSwiftlyToolchain(
    version: string,
    extensionRoot: string,
    logger?: SwiftLogger,
    folder?: vscode.Uri
): Promise<boolean> {
    logger?.info(`Attempting to handle missing toolchain: ${version}`);

    // Ask user for permission
    const userConsent = await showMissingToolchainDialog(version, folder);
    if (!userConsent) {
        logger?.info(`User declined to install missing toolchain: ${version}`);
        return false;
    }

    // Use the existing installation function without showing reload notification
    // (since we want to continue the current operation)
    return await installSwiftlyToolchainWithProgress(version, extensionRoot, logger);
}

export class Swiftly {
    public static cancellationMessage = "Installation cancelled by user";

    public static defaultHomeDir(): string {
        switch (process.platform) {
            case "linux": {
                if (process.env["XDG_DATA_HOME"]) {
                    return path.join(process.env["XDG_DATA_HOME"], "swiftly");
                }
                return path.join(os.homedir(), ".local/share/swiftly");
            }
            default:
                return path.join(os.homedir(), ".swiftly");
        }
    }

    /**
     * Downloads and installs Swiftly for the current platform
     */
    public static async installSwiftly(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        logger?: SwiftLogger
    ): Promise<void> {
        if (!this.isSupported()) {
            throw new Error("Swiftly is not supported on this platform");
        }

        switch (process.platform) {
            case "darwin":
                await this.installSwiftlyDarwin(progress, logger);
                break;
            case "linux":
                await this.installSwiftlyLinux(progress, logger);
                break;
            default:
                throw new Error(`Swiftly installation is not supported on ${process.platform}`);
        }
    }

    private static async installSwiftlyDarwin(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        logger?: SwiftLogger
    ): Promise<void> {
        const url = "https://download.swift.org/swiftly/darwin/swiftly.pkg";
        const downloadedPkgPath = await this.downloadSwiftlyInstaller(url, progress, logger);

        try {
            progress.report({ message: "Installing Swiftly package..." });

            await execFile("installer", [
                "-pkg",
                downloadedPkgPath,
                "-target",
                "CurrentUserHomeDirectory",
            ]);

            progress.report({ message: "Initializing Swiftly...", increment: -100 });
            await execFile(path.join(os.homedir(), ".swiftly", "bin", "swiftly"), [
                "init",
                "--assume-yes",
                "--quiet-shell-followup",
                "--skip-install",
            ]);

            progress.report({ message: "Swiftly installation completed", increment: 100 });
            logger?.info("Swiftly installation and initialization completed successfully");
        } catch (error) {
            logger?.error(`Failed to install Swiftly: ${error}`);
            throw new Error(`Failed to install Swiftly on macOS: ${(error as Error).message}`);
        } finally {
            try {
                await fs.unlink(downloadedPkgPath);
                await fs.rm(path.dirname(downloadedPkgPath), { recursive: true });
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    private static async installSwiftlyLinux(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        logger?: SwiftLogger
    ): Promise<void> {
        let tmpDir: string | undefined;

        try {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-swift-"));

            progress.report({ message: "Downloading Swiftly for Linux..." });

            const archMap: Record<string, string> = {
                x64: "x86_64",
                arm64: "aarch64",
            };
            const architecture = archMap[os.arch()] || os.arch();
            const url = `https://download.swift.org/swiftly/linux/swiftly-${architecture}.tar.gz`;
            const downloadedTarPath = await this.downloadSwiftlyInstaller(url, progress, logger);

            progress.report({ message: "Extracting Swiftly..." });

            await extract({
                file: downloadedTarPath,
                cwd: tmpDir,
            });

            progress.report({ message: "Initializing Swiftly..." });
            await execFile(
                "./swiftly",
                ["init", "--assume-yes", "--quiet-shell-followup", "--skip-install"],
                { cwd: tmpDir }
            );

            progress.report({ message: "Swiftly installation completed", increment: 100 });
            logger?.info("Swiftly installation completed successfully on Linux");
        } catch (error) {
            logger?.error(`Failed to install Swiftly on Linux: ${error}`);
            throw new Error(`Failed to install Swiftly on Linux: ${(error as Error).message}`);
        } finally {
            if (tmpDir) {
                try {
                    await fs.rm(tmpDir, { recursive: true, force: true });
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }

    private static async downloadSwiftlyInstaller(
        url: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        logger?: SwiftLogger
    ): Promise<string> {
        progress.report({ message: "Downloading Swiftly installer..." });

        let tmpDir: string | undefined;
        let filePath: string | undefined;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to download installer: HTTP ${response.status}`);
            }

            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-swift-"));
            const fileName = path.basename(url) || "swiftly-installer";
            filePath = path.join(tmpDir, fileName);

            if (!response.body) {
                throw new Error("Response body is null");
            }

            const contentLength = response.headers.get("content-length");
            const totalLength = contentLength ? parseInt(contentLength, 10) : 0;
            let downloadedLength = 0;
            let lastReportedPercent = 0;

            const fileStream = fsSync.createWriteStream(filePath);
            const reader = response.body.getReader();

            try {
                // eslint-disable-next-line no-constant-condition
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }

                    downloadedLength += value.length;
                    fileStream.write(value);

                    if (totalLength > 0) {
                        const percent = Math.floor((downloadedLength / totalLength) * 100);
                        if (percent > lastReportedPercent && percent % 10 === 0) {
                            progress.report({
                                message: `Downloading Swiftly installer... ${percent}%`,
                                increment: percent - lastReportedPercent,
                            });
                            lastReportedPercent = percent;
                        }
                    }
                }
            } finally {
                reader.releaseLock();
                fileStream.end();
            }

            await new Promise<void>((resolve, reject) => {
                fileStream.on("finish", () => {
                    fileStream.close(err => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
                fileStream.on("error", reject);
            });

            progress.report({ message: "Download completed" });
            logger?.info(`Swiftly installer downloaded to: ${filePath}`);

            return filePath;
        } catch (error) {
            // Cleanup temporary resources on error
            if (filePath) {
                try {
                    await fs.unlink(filePath);
                } catch {
                    // Swallow cleanup errors
                }
            }
            if (tmpDir) {
                try {
                    await fs.rm(tmpDir, { recursive: true });
                } catch {
                    // Swallow cleanup errors
                }
            }

            logger?.error(`Failed to download Swiftly installer: ${error}`);
            throw error;
        }
    }

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
     * Finds the list of toolchains installed via Swiftly.
     *
     * Toolchains will be sorted by version number in descending order.
     *
     * @returns an array of installed toolchains with name and optional location.
     */
    public static async list(logger?: SwiftLogger): Promise<InstalledToolchain[]> {
        if (!this.isSupported()) {
            return [];
        }
        const version = await Swiftly.version(logger);
        if (!version) {
            logger?.warn("Swiftly is not installed");
            return [];
        }

        if (!(await Swiftly.supportsJsonOutput(logger))) {
            return (await Swiftly.listFromSwiftlyConfig(logger)).map(name => ({ name }));
        }

        return await Swiftly.listUsingJSONFormat(logger);
    }

    private static async listUsingJSONFormat(logger?: SwiftLogger): Promise<InstalledToolchain[]> {
        try {
            const { stdout } = await execFile("swiftly", ["list", "--format=json"]);
            const parsed = SwiftlyListResult.parse(JSON.parse(stdout));
            type ParsedToolchain = (typeof parsed.toolchains)[number];
            const isKnownVersionType = (
                toolchain: ParsedToolchain
            ): toolchain is ParsedToolchain & { version: ToolchainVersion } =>
                ["system", "stable", "snapshot"].includes(toolchain.version.type);
            return parsed.toolchains
                .filter(isKnownVersionType)
                .sort((a, b) => compareSwiftlyToolchainVersion(a.version, b.version))
                .map(toolchain => ({
                    name: toolchain.version.name,
                    location: toolchain.location,
                }));
        } catch (error) {
            logger?.error(`Failed to retrieve Swiftly installations: ${error}`);
            return [];
        }
    }

    private static async listFromSwiftlyConfig(logger?: SwiftLogger) {
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
            return (
                installedToolchains
                    .filter((toolchain): toolchain is string => typeof toolchain === "string")
                    // Sort alphabetically in descending order.
                    //
                    // This isn't perfect (e.g. "5.10" will come before "5.9"), but this is
                    // good enough for legacy support.
                    .sort((lhs, rhs) => rhs.localeCompare(lhs))
            );
        } catch (error) {
            logger?.error(`Failed to retrieve Swiftly installations: ${error}`);
            throw new Error(
                `Failed to retrieve Swiftly installations from disk: ${(error as Error).message}`
            );
        }
    }

    /**
     * Checks whether or not the current operating system supports Swiftly.
     */
    public static isSupported() {
        return process.platform === "linux" || process.platform === "darwin";
    }

    /**
     * Retrieves the location of the toolchain that is currently in use by Swiftly.
     *
     * @param swiftlyPath Optional path to the Swiftly binary.
     * @param cwd Optional current working directory to check within.
     */
    public static async inUseLocation(swiftlyPath: string = "swiftly", cwd?: vscode.Uri) {
        const { stdout: inUse } = await execFile(swiftlyPath, ["use", "--print-location"], {
            cwd: cwd?.fsPath,
        });
        return inUse.trimEnd();
    }

    /**
     * Retrieves the version name of the toolchain that is currently in use by Swiftly.
     *
     * @param swiftlyPath Optional path to the Swiftly binary.
     * @param cwd Optional current working directory to check within.
     */
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

    /**
     * Instructs Swiftly to use a specific version of the Swift toolchain.
     *
     * @param version The version name to use. Obtainable via {@link Swiftly.list}.
     * @param [cwd] Optional working directory to set the toolchain within.
     */
    public static async use(version: string, cwd?: string): Promise<void> {
        if (!this.isSupported()) {
            throw new Error("Swiftly is not supported on this platform");
        }
        const useArgs = ["use", "-y"];
        const options: ExecFileOptions = {};
        if (cwd) {
            options.cwd = cwd;
            await touch(path.join(cwd, ".swift-version"));
        } else {
            useArgs.push("--global-default");
        }
        useArgs.push(version);
        await execFile("swiftly", useArgs, options);
    }

    /**
     * Determine whether or not the given swift binary is managed by swiftly.
     *
     * @param swiftBinaryPath The path to the swift binary.
     * @returns A boolean indicating whether or not the swift binary is managed by swiftly.
     */
    public static async isManagedBySwiftly(swiftBinaryPath: string): Promise<boolean> {
        const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
        if (!swiftlyHomeDir) {
            return false;
        }
        return swiftBinaryPath.startsWith(swiftlyHomeDir);
    }

    public static async getActiveToolchain(
        extensionRoot: string,
        cwd?: vscode.Uri,
        logger?: SwiftLogger
    ): Promise<string> {
        try {
            return await Swiftly.inUseLocation("swiftly", cwd);
        } catch (error: unknown) {
            if (error instanceof ExecFileError) {
                // Check if this is a missing toolchain error
                const missingToolchainError = parseSwiftlyMissingToolchainError(error.stderr);
                if (missingToolchainError) {
                    // Attempt automatic installation
                    const installed = await handleMissingSwiftlyToolchain(
                        missingToolchainError.version,
                        extensionRoot,
                        logger,
                        cwd
                    );
                    if (installed) {
                        // Retry toolchain location after successful installation
                        return await this.getActiveToolchain(extensionRoot, cwd, logger);
                    } else if (cwd) {
                        // If the user dismisses the installation prompt then fall back
                        // to using the global toolchain
                        return await Swiftly.getActiveToolchain(extensionRoot, undefined, logger);
                    }
                }
            }
            // We were unable to resolve the active swift toolchain.
            throw Error("Failed to determine the active swift toolchain via swiftly.", {
                cause: error,
            });
        }
    }

    /**
     * Lists all toolchains available for installation from swiftly.
     *
     * Toolchains will be sorted by version number in descending order.
     *
     * @param branch Optional branch to filter available toolchains (e.g., "main" for snapshots).
     * @param logger Optional logger for error reporting.
     * @returns Array of available toolchains.
     */
    public static async listAvailable(
        branch?: string,
        logger?: SwiftLogger
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
            logger?.warn("Swiftly version does not support JSON output for list-available");
            return [];
        }

        try {
            const args = ["list-available", "--format=json"];
            if (branch) {
                args.push(branch);
            }
            const { stdout: availableStdout } = await execFile("swiftly", args);
            return SwiftlyListAvailableResult.parse(JSON.parse(availableStdout))
                .toolchains.filter((t): t is AvailableToolchain =>
                    ["system", "stable", "snapshot"].includes(t.version.type)
                )
                .sort(compareSwiftlyToolchain);
        } catch (error) {
            logger?.error(`Failed to retrieve available Swiftly toolchains: ${error}`);
            return [];
        }
    }

    /**
     * Installs a toolchain via swiftly with optional progress tracking.
     *
     * @param version The toolchain version to install.
     * @param progressCallback Optional callback that receives progress data as JSON objects.
     * @param logger Optional logger for error reporting.
     * @param token Optional cancellation token to abort the installation.
     */
    public static async installToolchain(
        version: string,
        extensionRoot: string,
        progressCallback?: (progressData: SwiftlyProgressData) => void,
        logger?: SwiftLogger,
        token?: vscode.CancellationToken,
        swiftlyPath?: string
    ): Promise<void> {
        if (!this.isSupported()) {
            throw new Error("Swiftly is not supported on this platform");
        }

        logger?.info(`Installing toolchain ${version} via ${swiftlyPath ?? "swiftly"}`);

        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-swift-"));
        const postInstallFilePath = path.join(tmpDir, `post-install-${version}.sh`);

        let progressPipePath: string | undefined;
        let progressPromise: Promise<void> | undefined;

        if (progressCallback) {
            progressPipePath = path.join(tmpDir, `progress-${version}.pipe`);

            await execFile("mkfifo", [progressPipePath]);

            progressPromise = new Promise<void>((resolve, reject) => {
                const rl = readline.createInterface({
                    input: fsSync.createReadStream(progressPipePath!),
                    crlfDelay: Infinity,
                });

                // Handle cancellation during progress tracking
                const cancellationHandler = token?.onCancellationRequested(() => {
                    rl.close();
                    reject(new Error(Swiftly.cancellationMessage));
                });

                rl.on("line", (line: string) => {
                    if (token?.isCancellationRequested) {
                        rl.close();
                        return;
                    }

                    try {
                        const progressData = SwiftlyProgressData.parse(JSON.parse(line));
                        progressCallback(progressData);
                    } catch (error) {
                        logger?.error(
                            new Error(`Failed to parse Swiftly progress: ${line}`, { cause: error })
                        );
                    }
                });

                rl.on("close", () => {
                    cancellationHandler?.dispose();
                    resolve();
                });

                rl.on("error", err => {
                    cancellationHandler?.dispose();
                    reject(err);
                });
            });
        }

        const installArgs = [
            "install",
            version,
            "--assume-yes",
            "--post-install-file",
            postInstallFilePath,
        ];

        if (progressPipePath) {
            installArgs.push("--progress-file", progressPipePath);
        }

        try {
            // Create output streams for process output
            const stdoutStream = new Stream.PassThrough();
            const stderrStream = new Stream.PassThrough();

            // Use execFileStreamOutput with cancellation token
            const installPromise = execFileStreamOutput(
                swiftlyPath ?? "swiftly",
                installArgs,
                stdoutStream,
                stderrStream,
                token || null,
                {}
            );

            if (progressPromise) {
                await Promise.race([
                    Promise.all([installPromise, progressPromise]),
                    new Promise<never>((_, reject) => {
                        if (token) {
                            token.onCancellationRequested(() =>
                                reject(new Error(Swiftly.cancellationMessage))
                            );
                        }
                    }),
                ]);
            } else {
                await installPromise;
            }

            // Check for cancellation before post-install
            if (token?.isCancellationRequested) {
                throw new Error(Swiftly.cancellationMessage);
            }

            if (process.platform === "linux") {
                await this.handlePostInstallFile(
                    postInstallFilePath,
                    version,
                    extensionRoot,
                    logger
                );
            }
        } catch (error) {
            if (
                token?.isCancellationRequested ||
                (error as Error).message.includes(Swiftly.cancellationMessage)
            ) {
                logger?.info(`Installation of ${version} was cancelled by user`);
                throw new Error(Swiftly.cancellationMessage);
            }
            throw error;
        } finally {
            if (progressPipePath) {
                try {
                    await fs.unlink(progressPipePath);
                } catch {
                    // Ignore errors - file may not exist
                }
            }

            // Clean up post-install file
            try {
                await fs.unlink(postInstallFilePath);
            } catch {
                // Ignore errors - file may not exist
            }

            if (token?.isCancellationRequested) {
                logger?.info(`Cleaned up temporary files for cancelled installation of ${version}`);
            }
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
        extensionRoot: string,
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
            await this.executePostInstallScript(
                postInstallFilePath,
                version,
                extensionRoot,
                logger
            );
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
        extensionRoot: string,
        logger?: SwiftLogger
    ): Promise<void> {
        logger?.info(`Executing post-install script for toolchain ${version}`);

        const outputChannel = vscode.window.createOutputChannel(`Swift ${version} Post-Install`);

        try {
            outputChannel.show(true);
            outputChannel.appendLine(`Executing post-install script for Swift ${version}...`);
            outputChannel.appendLine(`Script location: ${postInstallFilePath}`);
            outputChannel.appendLine("Script contents:");
            const scriptContents = await fs.readFile(postInstallFilePath, "utf-8");
            for (const line of scriptContents.split(/\r?\n/)) {
                outputChannel.appendLine("    " + line);
            }
            outputChannel.appendLine("");

            await execFile("chmod", ["+x", postInstallFilePath]);

            const command = "sudo";
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

            await withAskpassServer(
                async (nonce, port) => {
                    await execFileStreamOutput(
                        command,
                        ["-A", ...args],
                        outputStream,
                        outputStream,
                        null,
                        {
                            env: {
                                ...process.env,
                                SUDO_ASKPASS: path.join(extensionRoot, "assets/swift_askpass.sh"),
                                VSCODE_SWIFT_ASKPASS_NODE: process.execPath,
                                VSCODE_SWIFT_ASKPASS_MAIN: path.join(
                                    extensionRoot,
                                    "dist/src/askpass/askpass-main.js"
                                ),
                                VSCODE_SWIFT_ASKPASS_NONCE: nonce,
                                VSCODE_SWIFT_ASKPASS_PORT: port.toString(10),
                            },
                        }
                    );
                },
                { title: "sudo password for Swiftly post-install script" }
            );

            outputChannel.appendLine("");
            outputChannel.appendLine(
                `Post-install script completed successfully for Swift ${version}`
            );

            void vscode.window.showInformationMessage(
                `Swift ${version} post-install script executed successfully. Additional system packages have been installed.`
            );
        } catch (error) {
            logger?.error(Error("Failed to execute post-install script", { cause: error }));
            void vscode.window
                .showErrorMessage(
                    `Failed to execute post-install script for Swift ${version}. See command output for more details.`,
                    "Show Command Output"
                )
                .then(selected => {
                    if (!selected) {
                        return;
                    }
                    outputChannel.show();
                });
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

    /**
     * Checks whether or not Swiftly is installed on the current system.
     */
    public static async isInstalled(): Promise<boolean> {
        if (!this.isSupported()) {
            return false;
        }
        try {
            return (await findBinaryInPath("swiftly")).length > 0;
        } catch (error) {
            return false;
        }
    }
}

function compareSwiftlyToolchain(lhs: AvailableToolchain, rhs: AvailableToolchain): number {
    return compareSwiftlyToolchainVersion(lhs.version, rhs.version);
}

function compareSwiftlyToolchainVersion(lhs: ToolchainVersion, rhs: ToolchainVersion): number {
    switch (lhs.type) {
        case "system": {
            if (rhs.type === "system") {
                return lhs.name.localeCompare(rhs.name);
            }
            return -1;
        }
        case "stable": {
            if (rhs.type === "stable") {
                const lhsVersion = new Version(lhs.major, lhs.minor, lhs.patch);
                const rhsVersion = new Version(rhs.major, rhs.minor, rhs.patch);
                return rhsVersion.compare(lhsVersion);
            }
            if (rhs.type === "system") {
                return 1;
            }
            return -1;
        }
        case "snapshot":
            if (rhs.type === "snapshot") {
                const lhsDate = new Date(lhs.date);
                const rhsDate = new Date(rhs.date);
                return rhsDate.getTime() - lhsDate.getTime();
            }
            return 1;
    }
}
