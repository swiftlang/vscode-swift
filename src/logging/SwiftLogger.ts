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
import * as fs from "fs";
import * as vscode from "vscode";
import * as winston from "winston";

import configuration from "../configuration";
import { IS_RUNNING_IN_DEVELOPMENT_MODE, IS_RUNNING_UNDER_TEST } from "../utilities/utilities";
import { OutputChannelTransport } from "./OutputChannelTransport";
import { RollingLog } from "./RollingLog";
import { RollingLogTransport } from "./RollingLogTransport";

// Winston work off of "any" as meta data so creating this
// type so we don't have to disable ESLint many times below
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LoggerMeta = any;
type LogMessageOptions = { append: boolean };

export class SwiftLogger implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private logger: winston.Logger;
    protected rollingLog: RollingLog;
    protected outputChannel: vscode.OutputChannel;
    private fileTransportReady = false;
    private pendingLogs: Array<{ level: string; message: string; meta?: LoggerMeta }> = [];

    constructor(
        public readonly name: string,
        public readonly logFilePath: string,
        logStoreLinesSize: number = 250_000 // default to capturing 250k log lines
    ) {
        this.rollingLog = new RollingLog(logStoreLinesSize);
        this.outputChannel = vscode.window.createOutputChannel(name);
        const ouptutChannelTransport = new OutputChannelTransport(this.outputChannel);
        ouptutChannelTransport.level = this.outputChannelLevel;
        const rollingLogTransport = new RollingLogTransport(this.rollingLog);

        // Create logger with minimal transports initially for faster startup
        const initialTransports = [
            ouptutChannelTransport,
            // Only want to capture the rolling log in memory when testing
            ...(IS_RUNNING_UNDER_TEST ? [rollingLogTransport] : []),
            ...(IS_RUNNING_IN_DEVELOPMENT_MODE
                ? [new winston.transports.Console({ level: "debug" })]
                : []),
        ];

        this.logger = winston.createLogger({
            transports: initialTransports,
            format: winston.format.combine(
                winston.format.errors({ stack: true }),
                winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }), // This is the format of `vscode.LogOutputChannel`
                winston.format.printf(msg => {
                    return `${msg.timestamp} [${msg.level}] ${msg.message}${msg.stack ? ` ${msg.stack}` : ""}`;
                }),
                winston.format.colorize()
            ),
        });

        // Add file transport asynchronously to avoid blocking startup
        setTimeout(() => {
            try {
                const fileTransport = new winston.transports.File({
                    filename: this.logFilePath,
                    level: "debug", // File logging at the 'debug' level always
                });

                // Add the file transport to the main logger
                this.logger.add(fileTransport);
                this.fileTransportReady = true;

                // Write buffered logs directly to the file using Node.js fs
                if (this.pendingLogs.length > 0) {
                    const logEntries =
                        this.pendingLogs
                            .map(({ level, message }) => {
                                const timestamp = new Date()
                                    .toISOString()
                                    .replace("T", " ")
                                    .replace("Z", "");
                                return `${timestamp} [${level}] ${message}`;
                            })
                            .join("\n") + "\n";

                    fs.appendFileSync(this.logFilePath, logEntries);
                }

                this.pendingLogs = []; // Clear the buffer
            } catch (error) {
                // If file transport fails, continue with output channel only
                this.logger.warn(`Failed to initialize file logging: ${error}`);
                this.fileTransportReady = true; // Mark as ready even if failed to stop buffering
                this.pendingLogs = []; // Clear the buffer
            }
        }, 0);
        this.disposables.push(
            {
                dispose: () => {
                    this.logger.close();
                    if (ouptutChannelTransport.close) {
                        ouptutChannelTransport.close();
                    }
                    if (rollingLogTransport.close) {
                        rollingLogTransport.close();
                    }
                },
            },
            vscode.workspace.onDidChangeConfiguration(e => {
                if (
                    e.affectsConfiguration("swift.outputChannelLogLevel") ||
                    e.affectsConfiguration("swift.diagnostics")
                ) {
                    // Clear cache when configuration changes
                    this._cachedOutputChannelLevel = undefined;
                    ouptutChannelTransport.level = this.outputChannelLevel;
                }
            })
        );
    }

    debug(message: LoggerMeta, label?: string, options?: LogMessageOptions) {
        const normalizedMessage = this.normalizeMessage(message, label);
        this.logWithBuffer("debug", normalizedMessage, options);
    }

    info(message: LoggerMeta, label?: string, options?: LogMessageOptions) {
        const normalizedMessage = this.normalizeMessage(message, label);
        this.logWithBuffer("info", normalizedMessage, options);
    }

    warn(message: LoggerMeta, label?: string, options?: LogMessageOptions) {
        const normalizedMessage = this.normalizeMessage(message, label);
        this.logWithBuffer("warn", normalizedMessage, options);
    }

    error(message: LoggerMeta, label?: string, options?: LogMessageOptions) {
        if (message instanceof Error) {
            this.logWithBuffer("error", message);
            return;
        }
        const normalizedMessage = this.normalizeMessage(message, label);
        this.logWithBuffer("error", normalizedMessage, options);
    }

    private logWithBuffer(level: string, message: string | Error, meta?: LoggerMeta) {
        // Always log to current transports (output channel, console, etc.)
        if (message instanceof Error) {
            this.logger.log(level, message);
        } else {
            this.logger.log(level, message, meta);
        }

        // If file transport isn't ready yet, buffer the log for replay
        if (!this.fileTransportReady) {
            this.pendingLogs.push({ level, message: message.toString(), meta });
        }
    }

    get logs(): string[] {
        return this.rollingLog.logs;
    }

    clear() {
        this.outputChannel.clear();
        this.rollingLog.clear();
    }

    private normalizeMessage(message: LoggerMeta, label?: string) {
        let fullMessage: string;
        if (typeof message === "string") {
            fullMessage = message;
        } else {
            try {
                fullMessage = JSON.stringify(message);
            } catch (e) {
                fullMessage = `${message}`;
            }
        }
        if (label !== undefined) {
            fullMessage = `${label}: ${message}`;
        }
        return fullMessage;
    }

    private _cachedOutputChannelLevel: string | undefined;

    private get outputChannelLevel(): string {
        // Cache the configuration lookup to avoid repeated expensive calls during initialization
        if (this._cachedOutputChannelLevel === undefined) {
            const info = vscode.workspace
                .getConfiguration("swift")
                .inspect("outputChannelLogLevel");
            // If the user has explicitly set `outputChannelLogLevel` then use it, otherwise
            // check the deprecated `diagnostics` property
            if (info?.globalValue || info?.workspaceValue || info?.workspaceFolderValue) {
                this._cachedOutputChannelLevel = configuration.outputChannelLogLevel;
            } else if (configuration.diagnostics) {
                this._cachedOutputChannelLevel = "debug";
            } else {
                this._cachedOutputChannelLevel = configuration.outputChannelLogLevel;
            }
        }
        return this._cachedOutputChannelLevel;
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}
