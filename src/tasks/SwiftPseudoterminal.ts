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
import * as vscode from "vscode";

import { SwiftProcess } from "./SwiftProcess";

/**
 * Implements {@link vscode.Pseudoterminal} to spawn a {@link SwiftProcess} for tasks
 * that provide a custom {@link vscode.CustomExecution}
 */
export class SwiftPseudoterminal implements vscode.Pseudoterminal, vscode.Disposable {
    private readonly writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private readonly closeEmitter: vscode.EventEmitter<number | void> = new vscode.EventEmitter<
        number | void
    >();
    private swiftProcess: SwiftProcess | undefined;

    constructor(
        private createSwiftProcess: () => SwiftProcess,
        private options: vscode.TaskPresentationOptions
    ) {}

    private disposables: vscode.Disposable[] = [];

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.swiftProcess = this.createSwiftProcess();
        const commandLine = [this.swiftProcess.command, ...this.swiftProcess.args].join(" ");
        try {
            // Convert the pty's events to the ones expected by the Tasks API
            this.disposables.push(
                this.swiftProcess.onDidSpawn(() => {
                    // Display the actual command line that we're executing. `echo` defaults to true.
                    if (this.options.echo !== false) {
                        this.writeEmitter.fire(`> ${commandLine}\n\n\r`);
                    }
                }),
                this.swiftProcess.onDidWrite(data => {
                    // The terminal expects a string that has "\n\r" line endings
                    this.writeEmitter.fire(data.replace(/\n(\r)?/g, "\n\r"));
                }),
                this.swiftProcess.onDidThrowError(e => {
                    void vscode.window.showErrorMessage(
                        `Failed to run Swift command "${commandLine}":\n${e}`
                    );
                    this.closeEmitter.fire();
                    this.dispose();
                }),
                this.swiftProcess.onDidClose(event => {
                    this.closeEmitter.fire(event);
                    this.dispose();
                })
            );
            this.swiftProcess.spawn();
            if (initialDimensions) {
                this.setDimensions(initialDimensions);
            }
        } catch (error) {
            this.closeEmitter.fire();
            this.dispose();
        }
    }

    dispose() {
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
        this.swiftProcess?.terminate();
        // Terminal may be re-used so only dispose of these on close
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
    }
}
