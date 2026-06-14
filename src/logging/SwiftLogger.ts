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
import * as winston from "winston";
import type * as Transport from "winston-transport";

import configuration from "../configuration";
import { Disposable } from "../utilities/Disposable";
import { IS_RUNNING_UNDER_DEBUGGER, IS_RUNNING_UNDER_TEST } from "../utilities/utilities";
import { FileTransport } from "./FileTransport";
import { OutputChannelTransport } from "./OutputChannelTransport";
import { RollingLog } from "./RollingLog";
import { RollingLogTransport } from "./RollingLogTransport";

type LogMessageOptions = { append: boolean };
type SwiftLoggerOptions = { logConsole?: boolean };

export class SwiftLogger implements Disposable {
    private subscriptions: Disposable[] = [];
    private logger: winston.Logger;
    protected rollingLog: RollingLog;
    protected outputChannel: vscode.OutputChannel;
    private fileTransport: FileTransport;
    private cachedOutputChannelLevel: string | undefined;
    private isDisposed: boolean = false;

    constructor(
        public readonly name: string,
        public readonly logFilePath: string,
        logStoreLinesSize: number = 250_000, // default to capturing 250k log lines
        options: SwiftLoggerOptions = {}
    ) {
        const { logConsole = true } = options;
        this.rollingLog = new RollingLog(logStoreLinesSize);
        this.outputChannel = vscode.window.createOutputChannel(name);
        const ouptutChannelTransport = new OutputChannelTransport(this.outputChannel);
        ouptutChannelTransport.level = this.outputChannelLevel;

        // Create file transport
        this.fileTransport = new FileTransport(this.logFilePath);
        this.fileTransport.level = "debug"; // File logging at the 'debug' level always

        // Create logger with all transports
        const transports: Transport[] = [ouptutChannelTransport, this.fileTransport];
        // We only want to capture the rolling log in memory when testing
        if (IS_RUNNING_UNDER_TEST) {
            const rollingLogTransport = new RollingLogTransport(this.rollingLog);
            transports.push(rollingLogTransport);
        }
        // Log everything to the console when we're debugging
        if (logConsole && IS_RUNNING_UNDER_DEBUGGER) {
            transports.push(new winston.transports.Console({ level: "debug" }));
        }

        this.logger = winston.createLogger({
            transports: transports,
            format: winston.format.combine(
                winston.format.errors({ stack: true, cause: true }),
                winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }), // This is the format of `vscode.LogOutputChannel`
                winston.format.printf(info => {
                    let message = `${info.message}`;
                    if (typeof info.stack === "string") {
                        message = info.stack;
                        if (info.cause) {
                            message += `\n${formatCauseChain(info.cause)}`;
                        }
                    }
                    return `${info.timestamp} [${info.level}] ${message}`;
                }),
                winston.format.colorize()
            ),
        });
        this.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (
                    e.affectsConfiguration("swift.outputChannelLogLevel") ||
                    e.affectsConfiguration("swift.diagnostics")
                ) {
                    // Clear cache when configuration changes
                    this.cachedOutputChannelLevel = undefined;
                    ouptutChannelTransport.level = this.outputChannelLevel;
                }
            })
        );
    }

    debug(message: unknown, label?: string, options?: LogMessageOptions) {
        const normalizedMessage = this.normalizeMessage(message, label);
        this.logWithBuffer("debug", normalizedMessage, options);
    }

    info(message: unknown, label?: string, options?: LogMessageOptions) {
        const normalizedMessage = this.normalizeMessage(message, label);
        this.logWithBuffer("info", normalizedMessage, options);
    }

    warn(message: unknown, label?: string, options?: LogMessageOptions) {
        const normalizedMessage = this.normalizeMessage(message, label);
        this.logWithBuffer("warn", normalizedMessage, options);
    }

    error(message: unknown, label?: string, options?: LogMessageOptions) {
        if (message instanceof Error) {
            this.logWithBuffer("error", message);
            return;
        }
        const normalizedMessage = this.normalizeMessage(message, label);
        this.logWithBuffer("error", normalizedMessage, options);
    }

    private logWithBuffer(level: string, message: string | Error, meta?: LogMessageOptions) {
        if (this.isDisposed) {
            return;
        }

        // Log to all transports (output channel, file, console, etc.)
        if (message instanceof Error) {
            this.logger.log(level, message);
        } else {
            this.logger.log(level, message, meta);
        }
    }

    get logs(): string[] {
        return this.rollingLog.logs;
    }

    clear() {
        this.outputChannel.clear();
        this.rollingLog.clear();
    }

    private normalizeMessage(message: unknown, label?: string) {
        let fullMessage: string;
        if (typeof message === "string") {
            fullMessage = message;
        } else {
            try {
                fullMessage = JSON.stringify(message);
            } catch (e) {
                fullMessage = String(message);
            }
        }
        if (label !== undefined) {
            fullMessage = `${label}: ${String(message)}`;
        }
        return fullMessage;
    }

    private get outputChannelLevel(): string {
        // Cache the configuration lookup to avoid repeated expensive calls during initialization
        if (this.cachedOutputChannelLevel === undefined) {
            const info = vscode.workspace
                .getConfiguration("swift")
                .inspect("outputChannelLogLevel");
            // If the user has explicitly set `outputChannelLogLevel` then use it, otherwise
            // check the deprecated `diagnostics` property
            if (info?.globalValue || info?.workspaceValue || info?.workspaceFolderValue) {
                this.cachedOutputChannelLevel = configuration.outputChannelLogLevel;
            } else if (configuration.diagnostics) {
                this.cachedOutputChannelLevel = "debug";
            } else {
                this.cachedOutputChannelLevel = configuration.outputChannelLogLevel;
            }
        }
        return this.cachedOutputChannelLevel;
    }

    dispose() {
        this.isDisposed = true;
        this.logger.close();
        this.rollingLog.clear();
        this.subscriptions.forEach(d => d.dispose());
    }
}

function formatCauseChain(cause: unknown): string {
    let result = "Caused by: ";
    if (cause instanceof Error) {
        result += cause.stack ?? cause.message;
        if (cause.cause) {
            result += `\n${formatCauseChain(cause.cause)}`;
        }
    } else {
        result += `${cause}`;
    }
    return result;
}
