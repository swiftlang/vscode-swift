//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025-2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

/**
 * Keeps the last `maxLogs` lines. When `maxHeadLogs` is set the first lines are kept as well,
 * with a line saying how many were dropped between them.
 */
export class RollingLog {
    private _head: string[] = [];
    private _logs: string[] = [];
    private _dropped = 0;

    constructor(
        private maxLogs: number,
        private maxHeadLogs: number = 0
    ) {}

    public get length(): number {
        return this._head.length + this._logs.length;
    }

    public get logs(): string[] {
        if (this.maxHeadLogs === 0 || this._dropped === 0) {
            return [...this._head, ...this._logs];
        }
        return [...this._head, `... ${this._dropped} lines omitted ...`, ...this._logs];
    }

    clear() {
        this._head = [];
        this._logs = [];
        this._dropped = 0;
    }

    appendLine(log: string): void {
        if (this._head.length < this.maxHeadLogs) {
            this._head.push(log);
            return;
        }
        this._logs.push(log);
        if (this._logs.length > this.maxLogs) {
            this._logs.shift();
            this._dropped++;
        }
    }
}
