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
import * as vscode from "vscode";

import { SwiftProcess } from "./SwiftProcess";

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
 * Implements {@link vscode.Pseudoterminal} to spawn a {@link SwiftProcess} for tasks
 * that provide a custom {@link vscode.CustomExecution}
 */
export class SwiftPseudoterminal implements vscode.Pseudoterminal, vscode.Disposable {
    private readonly writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter();
    private readonly closeEmitter: vscode.EventEmitter<number | void> = new vscode.EventEmitter();
    private swiftProcess: SwiftProcess | undefined;

    constructor(
        private createSwiftProcess: () => SwiftProcess,
        private options: vscode.TaskPresentationOptions
    ) {
        console.log(`[Pseudoterminal] Created pseudoterminal\n${getStackTrace()}`);
    }

    private disposables: vscode.Disposable[] = [];

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        console.log(`[Pseudoterminal] Opening pseudoterminal\n${getStackTrace()}`);
        this.swiftProcess = this.createSwiftProcess();
        const commandLine = [this.swiftProcess.command, ...this.swiftProcess.args].join(" ");
        try {
            // Convert the pty's events to the ones expected by the Tasks API
            this.disposables.push(
                this.swiftProcess.onDidSpawn(() => {
                    console.log(`[Pseudoterminal] Spawned ${commandLine}\n${getStackTrace()}`);
                    // Display the actual command line that we're executing. `echo` defaults to true.
                    if (this.options.echo !== false) {
                        this.writeEmitter.fire(`> ${commandLine}\n\n\r`);
                    }
                }),
                this.swiftProcess.onDidWrite(data => {
                    console.log(`[Pseudoterminal] Write Data -> "${data}"\n${getStackTrace()}`);
                    // The terminal expects a string that has "\n\r" line endings
                    this.writeEmitter.fire(data.replace(/\n(\r)?/g, "\n\r"));
                }),
                this.swiftProcess.onDidThrowError(e => {
                    console.error(
                        Error(`[Pseudoterminal] Swift process threw an error`, { cause: e })
                    );
                    void vscode.window.showErrorMessage(
                        `Failed to run Swift command "${commandLine}":\n${e}`
                    );
                    this.closeEmitter.fire();
                    this.dispose();
                }),
                this.swiftProcess.onDidClose(event => {
                    console.log(
                        `[Pseudoterminal] Swift process exited with code ${event}\n${getStackTrace()}`
                    );
                    this.closeEmitter.fire(event);
                    this.dispose();
                })
            );
            this.swiftProcess.spawn();
            if (initialDimensions) {
                this.setDimensions(initialDimensions);
            }
        } catch (error) {
            console.error(
                Error("[Pseudoterminal] Failed to launch Swift process", { cause: error })
            );
            this.closeEmitter.fire();
            this.dispose();
        }
    }

    dispose() {
        console.log(`[Pseudoterminal] Disposing of pseudoterminal\n${getStackTrace()}`);
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    /**
     * Called by vscode when the user interacts with the
     * terminal. Here we will handle any special sequences,
     * ex. ctrl+c to terminate, and otherwise pass the input along
     * to {@link SwiftProcess.handleInput}
     *
     * @param data VT sequence as a string
     */
    handleInput(data: string): void {
        const buf: Buffer = Buffer.from(data);
        // Terminate process on ctrl+c
        if (buf.length === 1 && buf[0] === 3) {
            this.swiftProcess?.terminate();
        } else {
            this.swiftProcess?.handleInput(data);
        }
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.swiftProcess?.setDimensions(dimensions);
    }

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    onDidClose: vscode.Event<number | void> = this.closeEmitter.event;

    close(): void {
        console.log(`[Pseudoterminal] Closing pseudoterminal\n${getStackTrace()}`);
        this.swiftProcess?.terminate();
        // Terminal may be re-used so only dispose of these on close
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
    }
}
