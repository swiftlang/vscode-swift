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
/* eslint-disable no-console */
import * as child_process from "child_process";
import type * as nodePty from "node-pty";
import * as vscode from "vscode";

import { requireNativeModule } from "../utilities/native";

const { spawn } = requireNativeModule<typeof nodePty>("node-pty");

export interface SwiftProcess extends vscode.Disposable {
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

class CloseHandler implements vscode.Disposable {
    private readonly closeEmitter: vscode.EventEmitter<number | void> = new vscode.EventEmitter<
        number | void
    >();
    private exitCode: number | void | undefined;
    private closeTimeout: NodeJS.Timeout | undefined;

    event = this.closeEmitter.event;

    handle(exitCode: number | void) {
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
    private disposables: vscode.Disposable[] = [];

    private spawnedProcess?: nodePty.IPty;

    constructor(
        public readonly command: string,
        public readonly args: string[],
        private options: vscode.ProcessExecutionOptions = {}
    ) {
        this.disposables.push(
            this.spawnEmitter,
            this.writeEmitter,
            this.errorEmitter,
            this.closeHandler
        );
    }

    spawn(): void {
        try {
            const isWindows = process.platform === "win32";
            // The pty process hangs on Windows when debugging the extension if we use conpty
            // See https://github.com/microsoft/node-pty/issues/640
            const useConpty = isWindows && process.env["VSCODE_DEBUG"] === "1" ? false : true;
            this.spawnedProcess = spawn(this.command, this.args, {
                cwd: this.options.cwd,
                env: { ...process.env, ...this.options.env },
                useConpty,
                // https://github.com/swiftlang/vscode-swift/issues/1074
                // Causing weird truncation issues
                cols: isWindows ? 4096 : undefined,
            });
            this.spawnEmitter.fire();
            this.spawnedProcess.onData(data => {
                this.writeEmitter.fire(data);
                this.closeHandler.reset();
            });
            this.spawnedProcess.onExit(event => {
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
                    this.dispose();
                })
            );
        } catch (error) {
            this.errorEmitter.fire(new Error(`${error}`));
            this.closeHandler.handle();
        }
    }

    handleInput(s: string): void {
        this.spawnedProcess?.write(s);
    }

    terminate(signal?: NodeJS.Signals): void {
        if (!this.spawnedProcess) {
            return;
        }
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
        this.disposables.forEach(d => d.dispose());
    }

    onDidSpawn: vscode.Event<void> = this.spawnEmitter.event;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    onDidThrowError: vscode.Event<Error> = this.errorEmitter.event;

    onDidClose: vscode.Event<number | void> = this.closeHandler.event;
}

function getStackTrace(): string {
    const stack = Error().stack;
    if (!stack) {
        return "";
    }
    return (
        stack
            .split("\n")
            .filter(l => l.startsWith("    at "))
            .slice(1)
            .join("\n") ?? ""
    );
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
    private readonly errorEmitter: vscode.EventEmitter<Error> = new vscode.EventEmitter<Error>();
    private readonly closeHandler: CloseHandler = new CloseHandler();
    private disposables: vscode.Disposable[] = [];

    private spawnedProcess: child_process.ChildProcessWithoutNullStreams | undefined;

    // eslint-disable-next-line sonarjs/no-identical-functions
    constructor(
        public readonly command: string,
        public readonly args: string[],
        private readonly options: vscode.ProcessExecutionOptions = {}
    ) {
        this.disposables.push(
            this.spawnEmitter,
            this.writeEmitter,
            this.errorEmitter,
            this.closeHandler
        );
    }

    spawn(): void {
        const commandLine = [this.command, ...this.args].join(" ");
        console.log(
            `[ReadOnlySwiftProcess] Spawning ${commandLine} in ${this.options.cwd ?? "workspace root"}\n${getStackTrace()}`
        );
        try {
            this.spawnedProcess = child_process.spawn(this.command, this.args, {
                cwd: this.options.cwd,
                env: { ...process.env, ...this.options.env },
            });
            this.spawnEmitter.fire();

            this.spawnedProcess.stdout.on("data", data => {
                this.writeEmitter.fire(data.toString());
                this.closeHandler.reset();
            });

            this.spawnedProcess.stderr.on("data", data => {
                this.writeEmitter.fire(data.toString());
                this.closeHandler.reset();
            });

            this.spawnedProcess.on("error", error => {
                this.errorEmitter.fire(new Error(`${error}`));
                this.closeHandler.handle();
            });

            this.spawnedProcess.once("exit", code => {
                this.closeHandler.handle(code ?? undefined);
            });

            this.disposables.push(
                this.onDidClose(() => {
                    this.dispose();
                })
            );
        } catch (error) {
            this.errorEmitter.fire(new Error(`${error}`));
            this.closeHandler.handle();
        }
    }

    handleInput(_s: string): void {
        // Do nothing
    }

    terminate(signal?: NodeJS.Signals): void {
        if (!this.spawnedProcess) {
            return;
        }
        this.spawnedProcess.kill(signal);
        this.dispose();
    }

    setDimensions(_dimensions: vscode.TerminalDimensions): void {
        // Do nothing
    }

    dispose(): void {
        this.spawnedProcess?.stdout.removeAllListeners();
        this.spawnedProcess?.stderr.removeAllListeners();
        this.spawnedProcess?.removeAllListeners();
        this.disposables.forEach(d => d.dispose());
    }

    onDidSpawn: vscode.Event<void> = this.spawnEmitter.event;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    onDidThrowError: vscode.Event<Error> = this.errorEmitter.event;

    onDidClose: vscode.Event<number | void> = this.closeHandler.event;
}
