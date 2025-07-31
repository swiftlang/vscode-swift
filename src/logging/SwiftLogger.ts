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
import { RollingLog } from "./RollingLog";
import { RollingLogTransport } from "./RollingLogTransport";
import { IS_RUNNING_UNDER_TEST } from "../utilities/utilities";
import { OutputChannelTransport } from "./OutputChannelTransport";
import configuration from "../configuration";

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
        this.logger = winston.createLogger({
            transports: [
                new winston.transports.File({
                    filename: this.logFilePath,
                    level: "debug", // File logging at the 'debug' level always
                }),
                ouptutChannelTransport,
                // Only want to capture the rolling log in memory when testing
                ...(IS_RUNNING_UNDER_TEST ? [rollingLogTransport] : []),
            ],
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
                },
            },
            vscode.workspace.onDidChangeConfiguration(e => {
                if (
                    e.affectsConfiguration("swift.outputChannelLogLevel") ||
                    e.affectsConfiguration("swift.diagnostics")
                ) {
                    ouptutChannelTransport.level = this.outputChannelLevel;
                }
            })
        );
    }

    debug(message: LoggerMeta, label?: string, options?: LogMessageOptions) {
        this.logger.debug(this.normalizeMessage(message, label), options);
    }

    info(message: LoggerMeta, label?: string, options?: LogMessageOptions) {
        this.logger.info(this.normalizeMessage(message, label), options);
    }

    warn(message: LoggerMeta, label?: string, options?: LogMessageOptions) {
        this.logger.warn(this.normalizeMessage(message, label), options);
    }

    error(message: LoggerMeta, label?: string, options?: LogMessageOptions) {
        if (message instanceof Error) {
            this.logger.error(message);
            return;
        }
        this.logger.error(this.normalizeMessage(message, label), options);
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
        const info = vscode.workspace.getConfiguration("swift").inspect("outputChannelLogLevel");
        // If the user has explicitly set `outputChannelLogLevel` then use it, otherwise
        // check the deprecated `diagnostics` property
        if (info?.globalValue || info?.workspaceValue || info?.workspaceFolderValue) {
            return configuration.outputChannelLogLevel;
        } else if (configuration.diagnostics) {
            return "debug";
        } else {
            return configuration.outputChannelLogLevel;
        }
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}
