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
import * as vscode from "vscode";
import * as TransportType from "winston-transport";

// Compile error if don't use "require": https://github.com/swiftlang/vscode-swift/actions/runs/16529946578/job/46752753379?pr=1746
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Transport: typeof TransportType = require("winston-transport");

export class OutputChannelTransport extends Transport {
    private appending: boolean = false;

    constructor(private readonly ouptutChannel: vscode.OutputChannel) {
        super();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public log(info: any, next: () => void): void {
        const logMessage = this.appending ? info.message : info[Symbol.for("message")];
        if (info.append) {
            this.ouptutChannel.append(logMessage);
            this.appending = true;
        } else {
            this.ouptutChannel.appendLine(logMessage);
            this.appending = false;
        }
        next();
    }
}
