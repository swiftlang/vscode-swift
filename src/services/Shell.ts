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
import * as cp from "child_process";
import * as stream from "stream";
import { CancellationToken, Disposable } from "vscode";

import { FolderContext } from "../FolderContext";
import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { SwiftToolchain } from "../toolchain/SwiftToolchain";
import { Environment } from "./Environment";

export interface Shell {
    /**
     * Asynchronous wrapper around {@link cp.execFile child_process.execFile}.
     *
     * Assumes output will be a string
     *
     * @param executable name of executable to run
     * @param args arguments to be passed to executable
     * @param options execution options
     */
    execFile(
        executable: string,
        args: string[],
        options?: cp.ExecFileOptions,
        customSwiftRuntime?: boolean
    ): Promise<{ stdout: string; stderr: string }>;

    execFileStreamOutput(
        executable: string,
        args: string[],
        stdout: stream.Writable | null,
        stderr: stream.Writable | null,
        token: CancellationToken | null,
        options?: cp.ExecFileOptions,
        folderContext?: FolderContext,
        customSwiftRuntime?: boolean,
        killSignal?: NodeJS.Signals
    ): Promise<void>;

    /**
     * Asynchronous wrapper around {@link cp.execFile child_process.execFile} running
     * swift executable
     *
     * @param args array of arguments to pass to swift executable
     * @param options execution options
     * @param setSDKFlags whether to set SDK flags
     */
    execSwift(
        args: string[],
        toolchain: SwiftToolchain | "default" | { swiftExecutable: string },
        options?: cp.ExecFileOptions,
        folderContext?: FolderContext
    ): Promise<{ stdout: string; stderr: string }>;

    findBinaryPath(binaryName: string, options?: cp.ExecFileOptions): Promise<string>;
}

export class NodeShell implements Shell {
    constructor(
        private readonly environment: Environment,
        private readonly config: typeof configuration,
        private readonly logger: SwiftLogger
    ) {}

    execFile(
        executable: string,
        args: string[],
        options: cp.ExecFileOptions = {},
        customSwiftRuntime: boolean = true
    ): Promise<{ stdout: string; stderr: string }> {
        if (customSwiftRuntime) {
            const runtimeEnv = this.environment.swiftRuntimeEnv(options.env);
            if (runtimeEnv && Object.keys(runtimeEnv).length > 0) {
                options.env = { ...(options.env ?? process.env), ...runtimeEnv };
            }
        }
        options = {
            ...options,
            maxBuffer: options.maxBuffer ?? 1024 * 1024 * 64, // 64MB
        };
        return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            cp.execFile(executable, args, options, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
                }
            });
        });
    }

    async execFileStreamOutput(
        executable: string,
        args: string[],
        stdout: stream.Writable | null,
        stderr: stream.Writable | null,
        token: CancellationToken | null,
        options: cp.ExecFileOptions = {},
        folderContext?: FolderContext,
        customSwiftRuntime = true,
        killSignal: NodeJS.Signals = "SIGTERM"
    ): Promise<void> {
        folderContext?.workspaceContext.logger.debug(
            `Exec: ${executable} ${args.join(" ")}`,
            folderContext.name
        );
        if (customSwiftRuntime) {
            const runtimeEnv = this.environment.swiftRuntimeEnv(options.env);
            if (runtimeEnv && Object.keys(runtimeEnv).length > 0) {
                options.env = { ...(options.env ?? process.env), ...runtimeEnv };
            }
        }
        return new Promise<void>((resolve, reject) => {
            let cancellation: Disposable;
            const p = cp.execFile(executable, args, options, error => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
                if (cancellation) {
                    cancellation.dispose();
                }
            });
            if (stdout) {
                p.stdout?.pipe(stdout);
            }
            if (stderr) {
                p.stderr?.pipe(stderr);
            }
            if (token) {
                cancellation = token.onCancellationRequested(() => {
                    p.kill(killSignal);
                });
            }
        });
    }

    async execSwift(
        args: string[],
        toolchain: SwiftToolchain | "default" | { swiftExecutable: string },
        options: cp.ExecFileOptions = {}
    ): Promise<{ stdout: string; stderr: string }> {
        let swift: string;
        if (typeof toolchain === "object" && "swiftExecutable" in toolchain) {
            swift = toolchain.swiftExecutable;
        } else if (toolchain === "default") {
            swift = this.environment.getExecutablePath();
        } else {
            swift = toolchain.getToolchainExecutable("swift");
            args = toolchain.buildFlags.withAdditionalFlags(args);
        }
        if (Object.keys(this.config.swiftEnvironmentVariables).length > 0) {
            // when adding environment vars we either combine with vars passed
            // into the function or the process environment vars
            options.env = {
                ...(options.env ?? process.env),
                ...this.config.swiftEnvironmentVariables,
            };
        }
        options = {
            ...options,
            maxBuffer: options.maxBuffer ?? 1024 * 1024 * 64, // 64MB
        };
        return await this.execFile(swift, args, options);
    }

    async findBinaryPath(binaryName: string, options: cp.ExecFileOptions = {}): Promise<string> {
        switch (this.environment.platform) {
            case "darwin": {
                const { stdout } = await this.execFile("which", [binaryName], options);
                return stdout.trimEnd();
            }
            case "win32": {
                const { stdout } = await this.execFile("where", [binaryName], options);
                const paths = stdout.trimEnd().split("\r\n");
                if (paths.length > 1) {
                    void this.logger.warn(
                        `Found multiple executables of the same name in %PATH%. Using excutable found at ${paths[0]}.`
                    );
                }
                return paths[0];
            }
            default: {
                // use `type swift` to find `swift`. Run inside /bin/sh to ensure
                // we get consistent output as different shells output a different
                // format. Tried running with `-p` but that is not available in /bin/sh
                const { stdout, stderr } = await this.execFile(
                    "/bin/sh",
                    ["-c", `LC_MESSAGES=C type ${binaryName}`],
                    options
                );
                const binaryNameMatch = new RegExp(`^${binaryName} is (.*)$`).exec(
                    stdout.trimEnd()
                );
                if (binaryNameMatch) {
                    return binaryNameMatch[1];
                } else {
                    throw Error(
                        `/bin/sh -c LC_MESSAGES=C type ${binaryName}: stdout: ${stdout}, stderr: ${stderr}`
                    );
                }
            }
        }
    }
}
