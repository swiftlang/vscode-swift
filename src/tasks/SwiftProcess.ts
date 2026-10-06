//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as child_process from "child_process";
import type * as nodePty from "node-pty";
import * as vscode from "vscode";

import { SwiftLogger } from "../logging/SwiftLogger";
import { Disposable } from "../utilities/Disposable";
import { safeBareRepositoryEnvironmentOverride } from "../utilities/gitConfig";
import { requireNativeModule } from "../utilities/native";

const { spawn } = requireNativeModule<typeof nodePty>("node-pty");

export interface SwiftProcessOptions extends vscode.ProcessExecutionOptions {
    logger?: SwiftLogger;
}

export interface SwiftProcess extends Disposable {
    /**
     * Resolved path to the `swift` executable
     */
    command: string;
    /**
     * `swift` arguments
     */
    args: string[];
    /**
     * Spawn the `swift` {@link command} with the specified {@link args}
     */
    spawn(): void;
    /**
     * Listen for `swift` pty process to get spawned
     */
    onDidSpawn: vscode.Event<void>;
    /**
     * Listen for output from the `swift` process. The `string` output
     * may contain ansii characters which you're event listener can
     * strip if desired.
     * @see `strip-ansi` module
     */
    onDidWrite: vscode.Event<string>;
    /**
     * Listen for `swift` pty process to fail to spawn
     */
    onDidThrowError: vscode.Event<Error>;
    /**
     * Listen for the `swift` process to close. The event listener will
     * be called with a `number` exit code if the process exited with an
     * exit code. No exit code will be provided if the `swift` process
     * exited from receiving a signal or if the process abnormally terminated.
     */
    onDidClose: vscode.Event<number | void>;
    /**
     * Write a VT sequence as a string to the pty process
     * to use as stdin
     *
     * @param s string to write to pty
     */
    handleInput(s: string): void;
    /**
     * Forcefully terminate the pty process. Optionally can provide a signal.
     */
    terminate(signal?: NodeJS.Signals): void;
    /**
     * Resize the pty to match the new {@link vscode.Pseudoterminal} dimensions
     *
     * @param dimensions
     */
    setDimensions(dimensions: vscode.TerminalDimensions): void;
}

class CloseHandler implements Disposable {
    private readonly closeEmitter: vscode.EventEmitter<number | void> = new vscode.EventEmitter<
        number | void
    >();
    private exitCode: number | void | undefined;
    private closeTimeout: NodeJS.Timeout | undefined;

    event = this.closeEmitter.event;

    logger?: SwiftLogger;
    description: () => string = () => "";

    handle(exitCode: number | void) {
        this.logger?.trace(`Process exit handled: ${this.description()}, exitCode=${exitCode}`, {
            label: "SwiftProcess",
        });
        this.exitCode = exitCode;
        this.queueClose();
    }

    reset() {
        if (this.closeTimeout) {
            clearTimeout(this.closeTimeout);
            this.queueClose();
        }
    }

    dispose() {
        this.closeEmitter.dispose();
    }

    private queueClose() {
        this.closeTimeout = setTimeout(() => {
            this.logger?.trace(
                `Firing process close: ${this.description()}, exitCode=${this.exitCode}`,
                { label: "SwiftProcess" }
            );
            this.closeEmitter.fire(this.exitCode);
        }, 250);
    }
}

/**
 * Wraps a {@link nodePty node-pty} instance to handle spawning a `swift` process
 * and feeds the process state and output through event emitters.
 */
export class SwiftPtyProcess implements SwiftProcess {
    private readonly spawnEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    private readonly writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private readonly errorEmitter: vscode.EventEmitter<Error> = new vscode.EventEmitter<Error>();
    private readonly closeHandler: CloseHandler = new CloseHandler();
    private disposables: Disposable[] = [];

    private spawnedProcess?: nodePty.IPty;

    constructor(
        public readonly command: string,
        public readonly args: string[],
        private options: SwiftProcessOptions = {}
    ) {
        this.closeHandler.logger = options.logger;
        this.closeHandler.description = () => this.describe();
        this.disposables.push(
            this.spawnEmitter,
            this.writeEmitter,
            this.errorEmitter,
            this.closeHandler
        );
    }

    private describe(): string {
        return `${this.args[0] ?? this.command}, pid=${this.spawnedProcess?.pid}`;
    }

    spawn(): void {
        const logger = this.options.logger;
        try {
            const isWindows = process.platform === "win32";
            // The pty process hangs on Windows when debugging the extension if we use conpty
            // See https://github.com/microsoft/node-pty/issues/640
            const useConpty = isWindows && process.env["VSCODE_DEBUG"] === "1" ? false : true;
            const env = { ...process.env, ...this.options.env };
            logger?.trace(
                `Spawning pty process: "${this.command} ${this.args.join(" ")}", cwd=${this.options.cwd}`,
                { label: "SwiftProcess" }
            );
            this.spawnedProcess = spawn(this.command, this.args, {
                cwd: this.options.cwd,
                env: { ...env, ...safeBareRepositoryEnvironmentOverride(env) },
                useConpty,
                // https://github.com/swiftlang/vscode-swift/issues/1074
                // Causing weird truncation issues
                cols: isWindows ? 4096 : undefined,
            });
            logger?.trace(`Spawned pty process: ${this.describe()}`, { label: "SwiftProcess" });
            this.spawnEmitter.fire();
            this.spawnedProcess.onData(data => {
                this.writeEmitter.fire(data);
                this.closeHandler.reset();
            });
            this.spawnedProcess.onExit(event => {
                logger?.trace(
                    `Pty process exited: ${this.describe()}, exitCode=${event.exitCode}, signal=${event.signal}`,
                    { label: "SwiftProcess" }
                );
                if (event.signal) {
                    this.closeHandler.handle(event.signal);
                } else if (typeof event.exitCode === "number") {
                    this.closeHandler.handle(event.exitCode);
                } else {
                    this.closeHandler.handle();
                }
            });
            this.disposables.push(
                this.onDidClose(() => {
                    logger?.trace(`Pty process closed, disposing: ${this.describe()}`, {
                        label: "SwiftProcess",
                    });
                    this.dispose();
                })
            );
        } catch (error) {
            logger?.debug(`Failed to spawn pty process: "${this.command}", error=${error}`, {
                label: "SwiftProcess",
            });
            this.errorEmitter.fire(new Error(`${error}`));
            this.closeHandler.handle();
        }
    }

    handleInput(s: string): void {
        this.spawnedProcess?.write(s);
    }

    terminate(signal?: NodeJS.Signals): void {
        if (!this.spawnedProcess) {
            this.options.logger?.trace(
                `Terminate requested before pty process spawned: "${this.command}"`,
                { label: "SwiftProcess" }
            );
            return;
        }
        this.options.logger?.trace(
            `Terminating pty process: ${this.describe()}, signal=${signal ?? "default"}`,
            { label: "SwiftProcess" }
        );
        this.spawnedProcess.kill(signal);
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        // https://github.com/swiftlang/vscode-swift/issues/1074
        // Causing weird truncation issues
        if (process.platform === "win32") {
            return;
        }
        this.spawnedProcess?.resize(dimensions.columns, dimensions.rows);
    }

    dispose() {
        this.options.logger?.trace(`Disposing pty process: ${this.describe()}`, {
            label: "SwiftProcess",
        });
        this.disposables.forEach(d => d.dispose());
    }

    onDidSpawn: vscode.Event<void> = this.spawnEmitter.event;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    onDidThrowError: vscode.Event<Error> = this.errorEmitter.event;

    onDidClose: vscode.Event<number | void> = this.closeHandler.event;
}

/**
 * A {@link SwiftProcess} that spawns a child process and does not bind to stdio.
 *
 * Use this for Swift tasks that do not need to accept input, as its lighter weight and
 * less error prone than using a spawned node-pty process.
 *
 * Specifically node-pty on Linux suffers from a long standing issue where the last chunk
 * of output before a program exits is sometimes dropped, especially if that program produces
 * a lot of output immediately before exiting. See https://github.com/microsoft/node-pty/issues/72
 */
export class ReadOnlySwiftProcess implements SwiftProcess {
    private readonly spawnEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    private readonly writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private readonly stdoutEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private readonly stderrEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private readonly errorEmitter: vscode.EventEmitter<Error> = new vscode.EventEmitter<Error>();
    private readonly closeHandler: CloseHandler = new CloseHandler();
    private disposables: Disposable[] = [];

    private spawnedProcess: child_process.ChildProcessWithoutNullStreams | undefined;

    constructor(
        public readonly command: string,
        public readonly args: string[],
        private readonly options: SwiftProcessOptions = {}
    ) {
        this.closeHandler.logger = options.logger;
        this.closeHandler.description = () => this.describe();
        this.disposables.push(
            this.spawnEmitter,
            this.writeEmitter,
            this.stdoutEmitter,
            this.stderrEmitter,
            this.errorEmitter,
            this.closeHandler
        );
    }

    private describe(): string {
        return `${this.args[0] ?? this.command}, pid=${this.spawnedProcess?.pid}`;
    }

    spawn(): void {
        const logger = this.options.logger;
        try {
            const env = { ...process.env, ...this.options.env };
            logger?.trace(
                `Spawning child process: "${this.command} ${this.args.join(" ")}", cwd=${this.options.cwd}`,
                { label: "SwiftProcess" }
            );
            this.spawnedProcess = child_process.spawn(this.command, this.args, {
                cwd: this.options.cwd,
                env: { ...env, ...safeBareRepositoryEnvironmentOverride(env) },
            });
            logger?.trace(`Spawned child process: ${this.describe()}`, { label: "SwiftProcess" });
            this.spawnEmitter.fire();

            this.spawnedProcess.stdout.on("data", data => {
                const text = data.toString();
                this.stdoutEmitter.fire(text);
                this.writeEmitter.fire(text);
                this.closeHandler.reset();
            });

            this.spawnedProcess.stderr.on("data", data => {
                const text = data.toString();
                this.stderrEmitter.fire(text);
                this.writeEmitter.fire(text);
                this.closeHandler.reset();
            });

            this.spawnedProcess.on("error", error => {
                logger?.trace(`Child process error: ${this.describe()}, error=${error}`, {
                    label: "SwiftProcess",
                });
                this.errorEmitter.fire(new Error(`${error}`));
                this.closeHandler.handle();
            });

            this.spawnedProcess.once("exit", (code, signal) => {
                logger?.trace(
                    `Child process exited: ${this.describe()}, exitCode=${code}, signal=${signal}`,
                    { label: "SwiftProcess" }
                );
                this.closeHandler.handle(code ?? undefined);
            });

            this.disposables.push(
                this.onDidClose(() => {
                    logger?.trace(`Child process closed, disposing: ${this.describe()}`, {
                        label: "SwiftProcess",
                    });
                    this.dispose();
                })
            );
        } catch (error) {
            logger?.debug(`Failed to spawn child process: "${this.command}", error=${error}`, {
                label: "SwiftProcess",
            });
            this.errorEmitter.fire(new Error(`${error}`));
            this.closeHandler.handle();
        }
    }

    handleInput(_s: string): void {
        // Do nothing
    }

    terminate(signal?: NodeJS.Signals): void {
        if (!this.spawnedProcess) {
            this.options.logger?.trace(
                `Terminate requested before child process spawned: "${this.command}"`,
                { label: "SwiftProcess" }
            );
            return;
        }
        this.options.logger?.trace(
            `Terminating child process: ${this.describe()}, signal=${signal ?? "default"}`,
            { label: "SwiftProcess" }
        );
        this.spawnedProcess.kill(signal);
        this.dispose();
    }

    setDimensions(_dimensions: vscode.TerminalDimensions): void {
        // Do nothing
    }

    dispose(): void {
        this.options.logger?.trace(`Disposing child process: ${this.describe()}`, {
            label: "SwiftProcess",
        });
        this.spawnedProcess?.stdout.removeAllListeners();
        this.spawnedProcess?.stderr.removeAllListeners();
        this.spawnedProcess?.removeAllListeners();
        this.disposables.forEach(d => d.dispose());
    }

    onDidSpawn: vscode.Event<void> = this.spawnEmitter.event;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    /**
     * Listen for stdout-only output from the child process. Use this when
     * parsing structured output (e.g. JSON) — `onDidWrite` interleaves stderr
     * which corrupts the parse.
     */
    onDidWriteStdout: vscode.Event<string> = this.stdoutEmitter.event;

    /** Listen for stderr-only output from the child process. */
    onDidWriteStderr: vscode.Event<string> = this.stderrEmitter.event;

    onDidThrowError: vscode.Event<Error> = this.errorEmitter.event;

    onDidClose: vscode.Event<number | void> = this.closeHandler.event;
}
