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
import * as winston from "winston";

import { Disposable } from "../utilities/Disposable";

import TransportStream = require("winston-transport");

// Winston's default log levels have no "trace", so add one below all the others.
const logLevels = { ...winston.config.npm.levels, trace: 7 };
winston.addColors({ trace: "gray" });

export class SwiftLogger implements Disposable {
    private logger: winston.Logger;
    private isDisposed: boolean = false;

    private static readonly Transport = class extends TransportStream {
        constructor(
            private logger: SwiftLogger,
            level: string
        ) {
            super({ level });
        }

        log(info: winston.Logform.TransformableInfo, next: () => void): void {
            const meta: { [key: string]: unknown } = {};
            Object.keys(info).forEach(key => {
                if (key === "level" || key === "message") {
                    return;
                }
                meta[key] = info[key];
            });
            this.logger.log(String(info[Symbol.for("level")]), info.message, meta);
            next();
        }
    };

    constructor(transports?: winston.transport[]) {
        this.logger = winston.createLogger({
            levels: logLevels,
            transports: transports,
            format: winston.format.combine(
                winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
                winston.format.printf(info => {
                    let prefix = `[${info.timestamp}] [${info.level}] `;
                    if (typeof info.label === "string") {
                        prefix += `${info.label}: `;
                    }
                    let message = `${info.message}`;
                    if (typeof info.stack === "string") {
                        message = info.stack;
                        if (info.cause) {
                            message += `\n${formatCauseChain(info.cause)}`;
                        }
                    }
                    return prefix + message;
                }),
                winston.format.colorize()
            ),
        });
    }

    /**
     * Creates a transport that forwards messages to this logger.
     *
     * @param level The most verbose level to forward.
     */
    createTransport(level: string = "debug"): winston.transport {
        return new SwiftLogger.Transport(this, level);
    }

    addTransport(transport: winston.transport): void {
        this.logger.add(transport);
    }

    removeTransport(transport: winston.transport): void {
        this.logger.remove(transport);
    }

    trace(message: unknown, meta: { label?: string } = {}) {
        this.log("trace", message, meta);
    }

    debug(message: unknown, meta: { label?: string } = {}) {
        this.log("debug", message, meta);
    }

    info(message: unknown, meta: { label?: string } = {}) {
        this.log("info", message, meta);
    }

    warn(message: unknown, meta: { label?: string } = {}) {
        this.log("warn", message, meta);
    }

    error(message: unknown, meta: { label?: string } = {}) {
        this.log("error", message, meta);
    }

    protected log(level: string, message: unknown, meta: { label?: string } = {}): void {
        if (this.isDisposed) {
            return;
        }

        if (typeof message === "string") {
            this.logger.log(level, message, meta);
            return;
        }

        if (message instanceof Error) {
            this.logger.log(level, message.message, {
                stack: message.stack,
                cause: message.cause,
                ...meta,
            });
            return;
        }

        this.logger.log(level, coerceToString(message), meta);
    }

    dispose() {
        this.isDisposed = true;
        this.logger.close();
    }
}

function coerceToString(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    try {
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
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
        result += coerceToString(cause);
    }
    return result;
}
