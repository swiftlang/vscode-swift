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

export class LoggedOutputChannel implements vscode.LogOutputChannel, Disposable {
    private channel: vscode.LogOutputChannel;
    private fileWriteStream: FileWriteStream;

    get name(): string {
        return this.channel.name;
    }

    get logLevel(): vscode.LogLevel {
        return this.channel.logLevel;
    }

    get onDidChangeLogLevel(): vscode.Event<vscode.LogLevel> {
        return this.channel.onDidChangeLogLevel;
    }

    constructor(name: string, logFilePath: Promise<string>) {
        this.channel = vscode.window.createOutputChannel(name, { log: true });
        this.fileWriteStream = new FileWriteStream(logFilePath);
    }

    append(value: string): void {
        this.channel.append(value);
        void this.fileWriteStream.write(value);
    }

    appendLine(value: string): void {
        this.channel.appendLine(value);
        void this.fileWriteStream.write(value + EOL);
    }

    trace(message: string, ...args: unknown[]): void {
        this.channel.trace(message, ...args);
        this.writeLogLine("Trace", message, args);
    }

    debug(message: string, ...args: unknown[]): void {
        this.channel.debug(message, ...args);
        this.writeLogLine("Debug", message, args);
    }

    info(message: string, ...args: unknown[]): void {
        this.channel.info(message, ...args);
        this.writeLogLine("Info", message, args);
    }

    warn(message: string, ...args: unknown[]): void {
        this.channel.warn(message, ...args);
        this.writeLogLine("Warning", message, args);
    }

    error(error: string | Error, ...args: unknown[]): void {
        this.channel.error(error, ...args);
        const message = error instanceof Error ? (error.stack ?? error.message) : error;
        this.writeLogLine("Error", message, args);
    }

    replace(value: string): void {
        this.clear();
        this.append(value);
    }

    clear(): void {
        this.channel.clear();
        void this.fileWriteStream.write(
            EOL + EOL + `================ Output Channel Cleared ================` + EOL + EOL
        );
    }

    show(arg1?: vscode.ViewColumn | boolean, arg2?: boolean): void {
        if (typeof arg1 === "number") {
            return this.channel.show(arg2);
        }
        this.channel.show(arg1);
    }

    hide(): void {
        this.channel.hide();
    }

    dispose(): void {
        this.channel.dispose();
        this.fileWriteStream.dispose();
    }

    private writeLogLine(level: string, message: string, args: unknown[]): void {
        const formattedArgs = args.length > 0 ? " " + args.map(arg => String(arg)).join(" ") : "";
        void this.fileWriteStream.write(`[${level}] ${message}${formattedArgs}${EOL}`);
    }
}
