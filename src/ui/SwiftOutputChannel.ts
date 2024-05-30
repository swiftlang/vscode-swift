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

export class SwiftOutputChannel {
    private channel: vscode.OutputChannel;
    private logStore = new RollingLog(1024 * 1024 * 5);

    constructor() {
        this.channel = vscode.window.createOutputChannel("Swift");
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
        this.sendLog(`${this.nowFormatted}: ${fullMessage}`);
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
        this.sendLog(`${this.nowFormatted}: ${fullMessage}`);
    }

    private sendLog(line: string) {
        this.channel.appendLine(line);
        this.logStore.append(line);

        if (process.env["CI"] !== "1") {
            console.log(line);
        }
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
    private _logs: string[] = [];
    private currentLogLength: number = 0;

    constructor(private maxSizeCharacters: number) {}

    public get logs(): string[] {
        return [...this._logs];
    }

    append(log: string) {
        // It can be costly to calculate the actual memory size of a string in Node so just
        // use the total number of characters in the logs as a huristic for total size.
        const logSize = log.length;

        while (this.currentLogLength + logSize > this.maxSizeCharacters && this.logs.length > 0) {
            const oldestLog = this.logs.shift();
            if (oldestLog) {
                this.currentLogLength -= oldestLog.length;
            }
        }

        this._logs.push(log);

        this.currentLogLength += logSize;
    }
}
