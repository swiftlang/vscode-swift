//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";

export interface LSPLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export class LSPOutputChannel implements LSPLogger {
    private _channel: vscode.OutputChannel | undefined;

    constructor(
        private name: string,
        private includeLogLevel: boolean = true,
        private includeTimestamp: boolean = true
    ) {}

    private get channel(): vscode.OutputChannel {
        if (!this._channel) {
            this._channel = vscode.window.createOutputChannel(this.name);
        }
        return this._channel;
    }

    dispose() {
        this._channel?.dispose();
        this._channel = undefined;
    }

    debug(message: string) {
        this.logOutputMessage("Debug", message);
    }

    info(message: string) {
        this.logOutputMessage("Info", message);
    }

    warn(message: string) {
        this.logOutputMessage("Warn", message);
    }

    error(message: string) {
        this.logOutputMessage("Error", message);
    }

    logOutputMessage(logLevel: string, message: string) {
        let formatted = "";
        if (this.includeLogLevel) {
            formatted = (formatted || "[") + logLevel.padEnd(5);
        }
        if (this.includeTimestamp) {
            formatted += formatted ? " - " : "[";
            formatted += new Date().toLocaleTimeString();
        }
        formatted += formatted ? "] " : " ";
        formatted += message;
        this.channel.appendLine(formatted);
    }
}
