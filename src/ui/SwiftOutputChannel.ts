//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import configuration from "../configuration";

export class SwiftOutputChannel implements vscode.OutputChannel {
    private channel: vscode.OutputChannel;
    private logStore: RollingLog;

    /**
     * Creates a vscode.OutputChannel that allows for later retrival of logs.
     * @param name
     */
    constructor(
        public name: string,
        private logToConsole: boolean = true,
        logStoreLinesSize: number = 250_000 // default to capturing 250k log lines
    ) {
        this.name = name;
        this.logToConsole = process.env["CI"] !== "1" && logToConsole;
        this.channel = vscode.window.createOutputChannel(name);
        this.logStore = new RollingLog(logStoreLinesSize);
    }

    append(value: string): void {
        this.channel.append(value);
        this.logStore.append(value);

        if (this.logToConsole) {
            console.log(value);
        }
    }

    appendLine(value: string): void {
        this.channel.appendLine(value);
        this.logStore.appendLine(value);

        if (this.logToConsole) {
            console.log(value);
        }
    }

    replace(value: string): void {
        this.channel.replace(value);
        this.logStore.replace(value);
    }

    clear(): void {
        this.channel.clear();
    }

    show(column?: unknown, preserveFocus?: boolean | undefined): void {
        this.channel.show(preserveFocus);
    }

    hide(): void {
        this.channel.hide();
    }

    dispose() {
        this.channel.dispose();
    }

    log(message: string, label?: string) {
        let fullMessage: string;
        if (label !== undefined) {
            fullMessage = `${label}: ${message}`;
        } else {
            fullMessage = message;
        }
        this.appendLine(`${this.nowFormatted}: ${fullMessage}`);
    }

    logDiagnostic(message: string, label?: string) {
        if (!configuration.diagnostics) {
            return;
        }
        let fullMessage: string;
        if (label !== undefined) {
            fullMessage = `${label}: ${message}`;
        } else {
            fullMessage = message;
        }
        this.appendLine(`${this.nowFormatted}: ${fullMessage}`);
    }

    get nowFormatted(): string {
        return new Date().toLocaleString("en-US", {
            hourCycle: "h23",
            hour: "2-digit",
            minute: "numeric",
            second: "numeric",
        });
    }

    get logs(): string[] {
        return this.logStore.logs;
    }
}

class RollingLog {
    private _logs: (string | null)[];
    private startIndex: number = 0;
    private endIndex: number = 0;
    private logCount: number = 0;

    constructor(private maxLogs: number) {
        this._logs = new Array(maxLogs).fill(null);
    }

    public get logs(): string[] {
        const logs: string[] = [];
        for (let i = 0; i < this.logCount; i++) {
            logs.push(this._logs[(this.startIndex + i) % this.maxLogs]!);
        }
        return logs;
    }

    private incrementIndex(index: number): number {
        return (index + 1) % this.maxLogs;
    }

    appendLine(log: string) {
        if (this.logCount === this.maxLogs) {
            this.startIndex = this.incrementIndex(this.startIndex);
        } else {
            this.logCount++;
        }

        this._logs[this.endIndex] = log;
        this.endIndex = this.incrementIndex(this.endIndex);
    }

    append(log: string) {
        const endIndex = this.endIndex - 1 < 0 ? Math.max(this.logCount - 1, 0) : this.endIndex;
        if (this._logs[endIndex] === null) {
            this.logCount = 1;
        }
        const newLogLine = (this._logs[endIndex] ?? "") + log;
        this._logs[endIndex] = newLogLine;
    }

    replace(log: string) {
        this._logs = new Array(this.maxLogs).fill(null);
        this._logs[0] = log;
        this.startIndex = 0;
        this.endIndex = 1;
        this.logCount = 1;
    }
}
