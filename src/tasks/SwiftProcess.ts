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

    handleInput(s: string): void {
        this.spawnedProcess?.write(s);
    }

    kill(): void {
        if (!this.spawnedProcess) {
            return;
        }
        this.spawnedProcess.kill();
        this.closeEmitter.fire(8);
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.spawnedProcess?.resize(dimensions.columns, dimensions.rows);
    }

    onDidSpawn: vscode.Event<void> = this.spawnEmitter.event;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    onDidThrowError: vscode.Event<Error> = this.errorEmitter.event;

    onDidClose: vscode.Event<number | void> = this.closeEmitter.event;
}
