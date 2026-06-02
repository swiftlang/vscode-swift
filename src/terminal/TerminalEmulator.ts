//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { IBuffer, Terminal } from "@xterm/headless";
import * as vscode from "vscode";

import { Disposable } from "../utilities/Disposable";

interface TerminalProcess {
    onDidWrite: vscode.Event<string>;
    onDidClose: vscode.Event<unknown>;
}

/**
 * Uses a headless xterm.js to properly handle terminal escape sequences coming from a PTY process.
 */
export class TerminalEmulator implements Disposable {
    private readonly terminal: Terminal;
    private readonly subscriptions: Disposable;
    private readonly inFlightWrites: Promise<void>[] = [];

    private lineDataEmitter = new vscode.EventEmitter<string>();
    public onDidReceiveLineData = this.lineDataEmitter.event;

    private closeEmitter = new vscode.EventEmitter<void>();
    public onDidClose = this.closeEmitter.event;

    constructor(process: TerminalProcess) {
        this.terminal = new Terminal({ allowProposedApi: true });
        this.subscriptions = Disposable.from(
            this.terminal.onLineFeed(() => {
                const buffer = this.terminal.buffer;
                const newLine = buffer.active.getLine(buffer.active.baseY + buffer.active.cursorY);
                if (newLine && !newLine.isWrapped) {
                    this.sendLineData(
                        buffer.active,
                        buffer.active.baseY + buffer.active.cursorY - 1
                    );
                }
            }),
            process.onDidWrite(data => {
                this.inFlightWrites.push(
                    new Promise<void>(resolve => {
                        this.terminal.write(data, resolve);
                    })
                );
            }),
            process.onDidClose(() => {
                void Promise.all(this.inFlightWrites).then(() => {
                    this.sendLineData(
                        this.terminal.buffer.active,
                        this.terminal.buffer.active.baseY + this.terminal.buffer.active.cursorY
                    );
                    this.closeEmitter.fire();
                });
            })
        );
    }

    private sendLineData(buffer: IBuffer, lineIndex: number): void {
        let line = buffer.getLine(lineIndex);
        if (!line) {
            return;
        }
        let lineData = line.translateToString(true);
        while (lineIndex > 0 && line.isWrapped) {
            lineIndex = lineIndex - 1;
            line = buffer.getLine(lineIndex);
            if (!line) {
                break;
            }
            lineData = line.translateToString(false) + lineData;
        }
        this.lineDataEmitter.fire(lineData);
    }

    public dispose(): void {
        this.terminal.dispose();
        this.subscriptions.dispose();
        this.lineDataEmitter.dispose();
        this.closeEmitter.dispose();
    }
}
