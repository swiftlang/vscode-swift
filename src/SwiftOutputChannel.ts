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

import * as vscode from 'vscode';
import { Disposable } from 'vscode-jsonrpc';

export class SwiftOutputChannel implements Disposable {
    private channel: vscode.OutputChannel;

    constructor() {
        this.channel = vscode.window.createOutputChannel("Swift");
    }

    dispose() {
        this.channel.dispose();
    }

    log(message: string, folder?: string) {
        if (folder) {
            folder += ": ";
        }
        this.channel.appendLine(`${this.nowFormatted}: ${folder ?? ""}${message}`);
    }

    logStart(message: string, folder?: string) {
        if (folder !== undefined) {
            folder += ": ";
        }
        this.channel.append(`${this.nowFormatted}: ${folder ?? ""}${message}`);
    }

    logEnd(message: string) {
        this.channel.appendLine(message);
    }

    get nowFormatted(): string {
        return new Date().toLocaleString('en-US', {hourCycle: 'h23', hour: '2-digit', minute: 'numeric', second: 'numeric'});
    }
}