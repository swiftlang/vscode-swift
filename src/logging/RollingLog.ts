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

export class RollingLog {
    private _logs: string[] = [];

    constructor(private maxLogs: number) {}

    public get length(): number {
        return this._logs.length;
    }

    public get logs(): string[] {
        return this._logs.slice();
    }

    clear() {
        this._logs = [];
    }

    appendLine(log: string): void {
        this._logs.push(log);
        if (this._logs.length > this.maxLogs) {
            this._logs.shift();
        }
    }
}
