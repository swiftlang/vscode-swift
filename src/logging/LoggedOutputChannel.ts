//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { EOL } from "os";
import * as vscode from "vscode";

import { Disposable } from "../utilities/Disposable";
import { FileWriteStream } from "./FileWriteStream";

export class LoggedOutputChannel implements vscode.OutputChannel, Disposable {
    private isDisposed: boolean;
    private channel: vscode.OutputChannel;
    private fileWriteStream: FileWriteStream;

    get name(): string {
        return this.channel.name;
    }

    constructor(name: string, logFilePath: Promise<string>) {
        this.isDisposed = false;
        this.channel = vscode.window.createOutputChannel(name);
        this.fileWriteStream = new FileWriteStream(logFilePath);
    }

    append(value: string): void {
        if (this.isDisposed) {
            return;
        }
        this.channel.append(value);
        void this.fileWriteStream.write(value);
    }

    appendLine(value: string): void {
        if (this.isDisposed) {
            return;
        }
        this.channel.appendLine(value);
        void this.fileWriteStream.write(value + EOL);
    }

    replace(value: string): void {
        if (this.isDisposed) {
            return;
        }
        this.clear();
        this.append(value);
    }

    clear(): void {
        if (this.isDisposed) {
            return;
        }
        this.channel.clear();
        void this.fileWriteStream.write(
            EOL + EOL + `================ Output Channel Cleared ================` + EOL + EOL
        );
    }

    show(arg1?: vscode.ViewColumn | boolean, arg2?: boolean): void {
        if (this.isDisposed) {
            return;
        }
        if (typeof arg1 === "number") {
            return this.channel.show(arg2);
        }
        this.channel.show(arg1);
    }

    hide(): void {
        if (this.isDisposed) {
            return;
        }
        this.channel.hide();
    }

    dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;
        this.channel.dispose();
        this.fileWriteStream.dispose();
    }
}
