//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import type * as nodePty from "node-pty";
import * as vscode from "vscode";

import { requireNativeModule } from "../utilities/native";
const { spawn } = requireNativeModule<typeof nodePty>("node-pty");

/**
 * Wraps a {@link nodePty node-pty} instance to handle spawning a `swift` process
 * and feeds the process state and output through event emitters.
 */
export class SwiftProcess {
    private readonly spawnEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    private readonly writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private readonly errorEmitter: vscode.EventEmitter<Error> = new vscode.EventEmitter<Error>();
    private readonly closeEmitter: vscode.EventEmitter<number | void> = new vscode.EventEmitter<
        number | void
    >();

    private spawnedProcess?: nodePty.IPty;

    constructor(
        private command: string,
        private args: string[],
        private options: vscode.ProcessExecutionOptions = {}
    ) {}

    get commandLine(): string {
        return [this.command, ...this.args].join(" ");
    }

    spawn(): void {
        try {
            // The pty process hangs on Windows when debugging the extension if we use conpty
            // See https://github.com/microsoft/node-pty/issues/640
            const useConpty =
                process.platform === "win32" && process.env["VSCODE_DEBUG"] === "1"
                    ? false
                    : undefined;
            this.spawnedProcess = spawn(this.command, this.args, {
                cwd: this.options.cwd,
                env: { ...process.env, ...this.options.env },
                useConpty,
            });
            this.spawnEmitter.fire();
            this.spawnedProcess.onData(data => {
                this.writeEmitter.fire(data);
            });
            this.spawnedProcess.onExit(event => {
                if (typeof event.exitCode === "number") {
                    this.closeEmitter.fire(event.exitCode);
                } else {
                    this.closeEmitter.fire();
                }
            });
        } catch (error) {
            this.errorEmitter.fire(new Error(`${error}`));
            this.closeEmitter.fire();
        }
    }

    /**
     * Write a VT sequence as a string to the pty process
     * to use as stdin
     *
     * @param s string to write to pty
     */
    handleInput(s: string): void {
        this.spawnedProcess?.write(s);
    }

    /**
     * Forcefully kill the pty process. The {@link onDidClose}
     * event will fire with exit code 8
     */
    kill(): void {
        if (!this.spawnedProcess) {
            return;
        }
        this.spawnedProcess.kill();
        this.closeEmitter.fire(8);
    }

    /**
     * Resize the pty to match the new {@link vscode.Pseudoterminal} dimensions
     *
     * @param dimensions
     */
    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.spawnedProcess?.resize(dimensions.columns, dimensions.rows);
    }

    /**
     * Listen for `swift` pty process to get spawned
     */
    onDidSpawn: vscode.Event<void> = this.spawnEmitter.event;

    /**
     * Listen for output from the `swift` process. The `string` output
     * may contain ansii characters which you're event listener can
     * strip if desired.
     * @see `strip-ansi` module
     */
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    /**
     * Listen for `swift` pty process to fail to spawn
     */
    onDidThrowError: vscode.Event<Error> = this.errorEmitter.event;

    /**
     * Listen for the `swift` process to close. The event listener will
     * be called with a `number` exit code if the process exited with an
     * exit code. No exit code will be provided if the `swift` process
     * exited from receiving a signal or if the process abnormally terminated.
     */
    onDidClose: vscode.Event<number | void> = this.closeEmitter.event;
}
