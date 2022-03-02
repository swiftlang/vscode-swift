//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";

export class SwiftOutputChannel {
    private channel: vscode.OutputChannel;

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
        const line = `${this.nowFormatted}: ${fullMessage}`;
        this.channel.appendLine(line);
        console.log(line);
    }

    logStart(message: string, label?: string) {
        let fullMessage: string;
        if (label !== undefined) {
            fullMessage = `${label}: ${message}`;
        } else {
            fullMessage = message;
        }
        const line = `${this.nowFormatted}: ${fullMessage}`;
        this.channel.append(line);
        console.log(line);
    }

    logEnd(message: string) {
        this.channel.appendLine(message);
        console.log(message);
    }

    get nowFormatted(): string {
        return new Date().toLocaleString("en-US", {
            hourCycle: "h23",
            hour: "2-digit",
            minute: "numeric",
            second: "numeric",
        });
    }
}
