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

import configuration from "../configuration";
import { IS_RUNNING_UNDER_TEST } from "../utilities/utilities";
import { FileTransport } from "./FileTransport";
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
    private fileTransport: FileTransport;
    private cachedOutputChannelLevel: string | undefined;

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

        // Create file transport
        this.fileTransport = new FileTransport(this.logFilePath);
        this.fileTransport.level = "debug"; // File logging at the 'debug' level always

        // Create logger with all transports
        const transports = [
            ouptutChannelTransport,
            this.fileTransport,
            // Only want to capture the rolling log in memory when testing
            ...(IS_RUNNING_UNDER_TEST ? [rollingLogTransport] : []),
        ];

        this.logger = winston.createLogger({
            transports: transports,
            format: winston.format.combine(
                winston.format.errors({ stack: true }),
                winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }), // This is the format of `vscode.LogOutputChannel`
                winston.format.printf(msg => {
                    return `${msg.timestamp} [${msg.level}] ${msg.message}${msg.stack ? ` ${msg.stack}` : ""}`;
                }),
                winston.format.colorize()
            ),
        });
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
                    this.fileTransport.close();
                },
            },
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
        this.disposables.forEach(d => d.dispose());
    }
}
