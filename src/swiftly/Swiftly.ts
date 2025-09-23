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
import { ExecFileException } from "child_process";
import * as path from "path";
import * as readline from "readline";
import * as stream from "stream";
import type * as vscode from "vscode";

import { Logger } from "../logging/Logger";
import { Environment } from "../services/Environment";
import { FileSystem } from "../services/FileSystem";
import { Shell } from "../services/Shell";
import { Result } from "../utilities/result";
import { SwiftlyError } from "./SwiftlyError";
import { SwiftlyVersion } from "./SwiftlyVersion";
import {
    AvailableToolchain,
    InUseVersionResult,
    ListAvailable,
    PostInstallValidationResult,
    SwiftlyList,
    SwiftlyProgressData,
} from "./types";

interface SwiftlyToolchainInfo {
    name: string;
    location: string;
}

export interface Swiftly {
    isSupported(): boolean;

    isInstalled(): Promise<boolean>;

    version(): Promise<Result<SwiftlyVersion, SwiftlyError>>;

    isSwiftlyToolchain(swiftBinary: string): Promise<boolean>;

    getActiveToolchain(cwd: string): Promise<Result<SwiftlyToolchainInfo, SwiftlyError>>;

    getInstalledToolchains(): Promise<Result<string[], SwiftlyError>>;

    use(version: string): Promise<Result<void, SwiftlyError>>;

    getAvailableToolchains(branch?: string): Promise<Result<AvailableToolchain[], SwiftlyError>>;

    installToolchain(
        version: string,
        progressCallback?: (progressData: SwiftlyProgressData) => void
    ): Promise<Result<void, SwiftlyError>>;
}

export class SwiftlyCLI implements Swiftly {
    constructor(
        private readonly fs: FileSystem,
        private readonly env: Environment,
        private readonly shell: Shell,
        private readonly window: typeof vscode.window,
        private readonly logger: Logger
    ) {}

    isSupported(): boolean {
        return ["darwin", "linux"].includes(this.env.platform);
    }

    async isInstalled(): Promise<boolean> {
        return (await this.version())
            .map(() => true)
            .flatMapError(() => Result.success(false))
            .getOrThrow();
    }

    version(): Promise<Result<SwiftlyVersion, SwiftlyError>> {
        return this.resultWithSwiftlyError(async () => {
            const { stdout } = await this.execSwiftly(["--version"]);
            return SwiftlyVersion.fromString(stdout.trim());
        });
    }

    async isSwiftlyToolchain(swiftBinary: string): Promise<boolean> {
        const swiftlyHomeDir: string | undefined = this.env.env()["SWIFTLY_HOME_DIR"];
        if (!swiftlyHomeDir) {
            return false;
        }
        const realSwiftBinary = await this.fs.realpath(swiftBinary);
        return realSwiftBinary.startsWith(swiftlyHomeDir);
    }

    getActiveToolchain(cwd: string): Promise<Result<SwiftlyToolchainInfo, SwiftlyError>> {
        return this.resultWithSwiftlyError<SwiftlyToolchainInfo>(async () => {
            const [name, location] = await Promise.all([
                // Get the name of the active toolchain
                this.version().then(async versionResult => {
                    const swiftlyVersion = versionResult.getOrThrow();
                    if (!swiftlyVersion.supportsJSONOutput) {
                        // Older versions of Swiftly do not support JSON output formatting.
                        // So, we have to read Swiftly's config.json directly.
                        const swiftlyHomeDir: string | undefined =
                            this.env.env()["SWIFTLY_HOME_DIR"];
                        if (!swiftlyHomeDir) {
                            throw SwiftlyError.unknown({
                                message: "Unable to find $SWIFTLY_HOME_DIR environment variable.",
                            });
                        }
                        const swiftlyConfig = JSON.parse(
                            await this.fs.readFile(
                                path.join(swiftlyHomeDir, "config.json"),
                                "utf-8"
                            )
                        );
                        if (!swiftlyConfig || !("inUse" in swiftlyConfig)) {
                            throw SwiftlyError.unknown({
                                message:
                                    "Property 'inUse' was not found in the Swiftly configuration file.",
                            });
                        }
                        if (typeof swiftlyConfig.inUse !== "string") {
                            throw SwiftlyError.unknown({
                                message:
                                    "Property 'inUse' was not a string in the Swiftly configuration file",
                            });
                        }
                        return swiftlyConfig.inUse;
                    }

                    const { stdout } = await this.execSwiftly(["use", "--format=json"], { cwd });
                    const result = InUseVersionResult.parse(JSON.parse(stdout));
                    return result.version;
                }),
                // Get the path to the active toolchain
                this.execSwiftly(["use", "--print-location"], { cwd }).then(result =>
                    result.stdout.trim()
                ),
            ]);
            return { name, location };
        });
    }

    getInstalledToolchains(): Promise<Result<string[], SwiftlyError>> {
        return this.resultWithSwiftlyError(async () => {
            const version = (await this.version()).getOrThrow();
            if (!version.supportsJSONOutput) {
                // Older versions of Swiftly do not support JSON output formatting.
                // So, we have to read Swiftly's config.json directly.
                const swiftlyHomeDir: string | undefined = this.env.env()["SWIFTLY_HOME_DIR"];
                if (!swiftlyHomeDir) {
                    throw SwiftlyError.unknown({
                        message: "Unable to find $SWIFTLY_HOME_DIR environment variable.",
                    });
                }
                const swiftlyConfig = JSON.parse(
                    await this.fs.readFile(path.join(swiftlyHomeDir, "config.json"), "utf-8")
                );
                if (!swiftlyConfig || !("installedToolchains" in swiftlyConfig)) {
                    throw SwiftlyError.unknown({
                        message:
                            "Property 'installedToolchains' was not found in the Swiftly configuration file.",
                    });
                }
                const installedToolchains = swiftlyConfig.installedToolchains;
                if (!Array.isArray(installedToolchains)) {
                    throw SwiftlyError.unknown({
                        message:
                            "Property 'installedToolchains' in the Swiftly configuration file is not an array.",
                    });
                }
                return installedToolchains.filter((t): t is string => typeof t === "string");
            }

            const { stdout } = await this.execSwiftly(["list", "--format=json"]);
            const response = SwiftlyList.parse(JSON.parse(stdout));
            return response.toolchains.map(t => t.version.name);
        });
    }

    use(version: string): Promise<Result<void, SwiftlyError>> {
        return this.resultWithSwiftlyError(async () => {
            await this.execSwiftly(["use", version]);
        });
    }

    async getAvailableToolchains(
        branch?: string
    ): Promise<Result<AvailableToolchain[], SwiftlyError>> {
        return this.resultWithSwiftlyError(async () => {
            const version = (await this.version()).getOrThrow();
            if (!version.supportsJSONOutput) {
                throw SwiftlyError.methodNotSupported({
                    message:
                        "Unable to list available toolchains as Swiftly does not support JSON output.",
                });
            }

            const args = ["list-available", "--format=json"];
            if (branch) {
                args.push(branch);
            }
            const { stdout } = await this.execSwiftly(args);
            const stdoutJSON = JSON.parse(stdout);
            return ListAvailable.parse(stdoutJSON).toolchains;
        });
    }

    async installToolchain(
        version: string,
        progressCallback?: (progressData: SwiftlyProgressData) => void
    ): Promise<Result<void, SwiftlyError>> {
        return this.resultWithSwiftlyError(async () => {
            const swiftlyVersion = (await this.version()).getOrThrow();
            if (!swiftlyVersion.supportsJSONOutput) {
                throw SwiftlyError.methodNotSupported({
                    message:
                        "Unable to install toolchain because Swiftly does not support JSON output.",
                });
            }

            this.logger.info(`Installing toolchain ${version} via swiftly`);

            return this.fs.withTemporaryDirectory("vscode-swiftly-install-", async tmpDir => {
                const promises: Promise<void>[] = [];
                const postInstallFilePath = path.join(tmpDir, `post-install-${version}.sh`);
                const installArgs = [
                    "install",
                    version,
                    "--use",
                    "--assume-yes",
                    "--post-install-file",
                    postInstallFilePath,
                ];

                if (progressCallback) {
                    const progressPipePath = path.join(tmpDir, `progress-${version}.pipe`);
                    installArgs.push("--progress-file", progressPipePath);

                    await this.shell.execFile("mkfifo", [progressPipePath]);

                    promises.push(
                        new Promise<void>((resolve, reject) => {
                            const rl = readline.createInterface({
                                input: this.fs.createReadStream(progressPipePath),
                                crlfDelay: Infinity,
                            });

                            rl.on("line", (line: string) => {
                                try {
                                    const progressData = JSON.parse(
                                        line.trim()
                                    ) as SwiftlyProgressData;
                                    progressCallback(progressData);
                                } catch (err) {
                                    this.logger.error(`Failed to parse progress line: ${err}`);
                                }
                            });

                            rl.on("close", () => {
                                resolve();
                            });

                            rl.on("error", err => {
                                reject(err);
                            });
                        })
                    );
                }

                await Promise.all([this.execSwiftly(installArgs), ...promises]);

                if (this.env.platform === "linux") {
                    await this.handlePostInstallFile(postInstallFilePath, version);
                }
            });
        });
    }

    /**
     * Handles post-install file created by swiftly installation (Linux only)
     *
     * @param postInstallFilePath Path to the post-install script
     * @param version The toolchain version being installed
     * @param logger Optional logger for error reporting
     */
    private async handlePostInstallFile(
        postInstallFilePath: string,
        version: string
    ): Promise<void> {
        try {
            await this.fs.access(postInstallFilePath);
        } catch {
            this.logger.info(`No post-install steps required for toolchain ${version}`);
            return;
        }

        this.logger.info(`Post-install file found for toolchain ${version}`);

        const validation = await this.validatePostInstallScript(postInstallFilePath);

        if (!validation.isValid) {
            const errorMessage = `Post-install script contains unsafe commands. Invalid commands: ${validation.invalidCommands?.join(", ")}`;
            this.logger.error(errorMessage);
            void this.window.showErrorMessage(
                `Installation of Swift ${version} requires additional system packages, but the post-install script contains commands that are not allowed for security reasons.`
            );
            return;
        }

        const shouldExecute = await this.showPostInstallConfirmation(version, validation);

        if (shouldExecute) {
            await this.executePostInstallScript(postInstallFilePath, version);
        } else {
            this.logger.warn(`Swift ${version} post-install script execution cancelled by user`);
            void this.window.showWarningMessage(
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
    private async validatePostInstallScript(
        postInstallFilePath: string
    ): Promise<PostInstallValidationResult> {
        try {
            const scriptContent = await this.fs.readFile(postInstallFilePath, "utf-8");
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
            this.logger.error(`Failed to validate post-install script: ${error}`);
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
    private async showPostInstallConfirmation(
        version: string,
        validation: PostInstallValidationResult
    ): Promise<boolean> {
        const summaryLines = validation.summary.split("\n");
        const firstTwoLines = summaryLines.slice(0, 2).join("\n");

        const message =
            `Swift ${version} installation requires additional system packages to be installed. ` +
            `This will require administrator privileges.\n\n${firstTwoLines}\n\n` +
            `Do you want to proceed with running the post-install script?`;

        this.logger.warn(
            `User confirmation required to execute post-install script for Swift ${version} installation,
                this requires ${firstTwoLines} permissions.`
        );
        const choice = await this.window.showWarningMessage(
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
    private async executePostInstallScript(
        postInstallFilePath: string,
        version: string
    ): Promise<void> {
        this.logger.info(`Executing post-install script for toolchain ${version}`);

        const outputChannel = this.window.createOutputChannel(`Swift ${version} Post-Install`);

        try {
            outputChannel.show(true);
            outputChannel.appendLine(`Executing post-install script for Swift ${version}...`);
            outputChannel.appendLine(`Script location: ${postInstallFilePath}`);
            outputChannel.appendLine("");

            await this.shell.execFile("chmod", ["+x", postInstallFilePath]);

            const command = "pkexec";
            const args = [postInstallFilePath];

            outputChannel.appendLine(`Executing: ${command} ${args.join(" ")}`);
            outputChannel.appendLine("");

            const outputStream = new stream.Writable({
                write(chunk, _encoding, callback) {
                    const text = chunk.toString();
                    outputChannel.append(text);
                    callback();
                },
            });

            await this.shell.execFileStreamOutput(
                command,
                args,
                outputStream,
                outputStream,
                null,
                {}
            );

            outputChannel.appendLine("");
            outputChannel.appendLine(
                `Post-install script completed successfully for Swift ${version}`
            );

            void this.window.showInformationMessage(
                `Swift ${version} post-install script executed successfully. Additional system packages have been installed.`
            );
        } catch (error) {
            const errorMsg = `Failed to execute post-install script: ${error}`;
            this.logger.error(errorMsg);
            outputChannel.appendLine("");
            outputChannel.appendLine(`Error: ${errorMsg}`);

            void this.window.showErrorMessage(
                `Failed to execute post-install script for Swift ${version}. Check the output channel for details.`
            );
        }
    }

    private async execSwiftly(
        args: string[],
        options: { cwd?: string } = {}
    ): Promise<{ stdout: string; stderr: string }> {
        try {
            return await this.shell.execFile("swiftly", args, { cwd: options.cwd });
        } catch (error) {
            if ((error as ExecFileException).code === "ENOENT") {
                throw SwiftlyError.notInstalled({ cause: error });
            }
            throw error;
        }
    }
    async resultWithSwiftlyError<T>(
        body: () => Promise<T>,
        transformError?: (error: unknown) => SwiftlyError
    ): Promise<Result<T, SwiftlyError>> {
        if (!this.isSupported()) {
            return Result.failure(SwiftlyError.osNotSupported());
        }

        try {
            return Result.success(await body());
        } catch (error) {
            if (error instanceof SwiftlyError) {
                return Result.failure(error);
            }
            if (!transformError) {
                return Result.failure(SwiftlyError.unknown({ cause: error }));
            }
            return Result.failure(transformError(error));
        }
    }
}
