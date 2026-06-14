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
import type * as winston from "winston";

import TransportStream = require("winston-transport");

export class OutputChannelTransport extends TransportStream {
    private appending: boolean = false;

    constructor(private readonly ouptutChannel: vscode.OutputChannel) {
        super();
    }

    public log(info: winston.Logform.TransformableInfo, next: () => void): void {
        const logMessage = String(this.appending ? info.message : info[Symbol.for("message")]);
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
