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
import * as vscode from "vscode";

/**
 * The {@link vscode.LogOutputChannel} that vscode-languageclient 10 and later require, on top of
 * an output channel that also writes the log file. Messages keep the `[Info  - <time>]` format
 * that vscode-languageclient 9 wrote.
 *
 * The client only traces the server when its channel's log level is `Trace`, so the log level is
 * `Trace` while the `trace.server` setting in `section` isn't `off`.
 */
export class LanguageClientOutputChannel implements vscode.LogOutputChannel {
    private readonly onDidChangeLogLevelEmitter = new vscode.EventEmitter<vscode.LogLevel>();
    private readonly configurationListener: vscode.Disposable;
    private level: vscode.LogLevel;

    readonly onDidChangeLogLevel = this.onDidChangeLogLevelEmitter.event;

    constructor(
        private readonly channel: vscode.OutputChannel,
        private readonly section: string
    ) {
        this.level = this.levelFromConfiguration();
        this.configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (!event.affectsConfiguration(`${section}.trace.server`)) {
                return;
            }
            const level = this.levelFromConfiguration();
            if (level !== this.level) {
                this.level = level;
                this.onDidChangeLogLevelEmitter.fire(level);
            }
        });
    }

    get name(): string {
        return this.channel.name;
    }

    get logLevel(): vscode.LogLevel {
        return this.level;
    }

    trace(message: string, ...args: unknown[]): void {
        this.log("Trace", message, args);
    }

    debug(message: string, ...args: unknown[]): void {
        this.log("Debug", message, args);
    }

    info(message: string, ...args: unknown[]): void {
        this.log("Info", message, args);
    }

    warn(message: string, ...args: unknown[]): void {
        this.log("Warn", message, args);
    }

    error(error: string | Error, ...args: unknown[]): void {
        this.log("Error", typeof error === "string" ? error : (error.stack ?? error.message), args);
    }

    append(value: string): void {
        this.channel.append(value);
    }

    appendLine(value: string): void {
        this.channel.appendLine(value);
    }

    replace(value: string): void {
        this.channel.replace(value);
    }

    clear(): void {
        this.channel.clear();
    }

    show(preserveFocus?: boolean): void;
    show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
    show(arg1?: vscode.ViewColumn | boolean, arg2?: boolean): void {
        if (typeof arg1 === "number") {
            this.channel.show(arg1, arg2);
        } else {
            this.channel.show(arg1);
        }
    }

    hide(): void {
        this.channel.hide();
    }

    dispose(): void {
        this.configurationListener.dispose();
        this.onDidChangeLogLevelEmitter.dispose();
        this.channel.dispose();
    }

    private log(level: string, message: string, args: unknown[]): void {
        const text = [message, ...args.map(arg => String(arg))].join(" ");
        this.channel.appendLine(
            `[${level.padEnd(5)} - ${new Date().toLocaleTimeString()}] ${text}`
        );
    }

    private levelFromConfiguration(): vscode.LogLevel {
        const trace = vscode.workspace.getConfiguration(this.section).get<string>("trace.server");
        return trace && trace !== "off" ? vscode.LogLevel.Trace : vscode.LogLevel.Info;
    }
}
