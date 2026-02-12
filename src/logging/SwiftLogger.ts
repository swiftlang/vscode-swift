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
import { IS_RUNNING_UNDER_DEBUGGER, IS_RUNNING_UNDER_TEST } from "../utilities/utilities";
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
    private subscriptions: vscode.Disposable[] = [];
    private logger: winston.Logger;
    protected rollingLog: RollingLog;
    protected outputChannel: vscode.OutputChannel;
    private fileTransport: FileTransport;
    private cachedOutputChannelLevel: string | undefined;
    private isDisposed: boolean = false;

    constructor(
        public readonly name: string,
        public readonly logFilePath: string,
        logStoreLinesSize: number = 250_000 // default to capturing 250k log lines
    ) {
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
        if (IS_RUNNING_UNDER_DEBUGGER) {
            transports.push(new winston.transports.Console({ level: "debug" }));
        }

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
        this.isDisposed = true;
        this.logger.close();
        this.rollingLog.clear();
        this.subscriptions.forEach(d => d.dispose());
    }
}
