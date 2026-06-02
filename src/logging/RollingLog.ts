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

export class RollingLog {
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

    clear() {
        this._logs = new Array(this.maxLogs).fill(null);
        this.startIndex = 0;
        this.endIndex = 0;
        this.logCount = 0;
    }

    appendLine(log: string) {
        // Writing to a new line that isn't the very first, increment the end index
        if (this.logCount > 0) {
            this.endIndex = this.incrementIndex(this.endIndex);
        }

        // We're over the window size, move the start index
        if (this.logCount === this.maxLogs) {
            this.startIndex = this.incrementIndex(this.startIndex);
        } else {
            this.logCount++;
        }

        this._logs[this.endIndex] = log;
    }

    append(log: string) {
        if (this.logCount === 0) {
            this.logCount = 1;
        }
        const newLogLine = (this._logs[this.endIndex] ?? "") + log;
        this._logs[this.endIndex] = newLogLine;
    }

    replace(log: string) {
        this._logs = new Array(this.maxLogs).fill(null);
        this._logs[0] = log;
        this.startIndex = 0;
        this.endIndex = 1;
        this.logCount = 1;
    }
}
