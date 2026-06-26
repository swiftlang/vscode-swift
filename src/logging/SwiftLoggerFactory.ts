//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025-2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import * as winston from "winston";

import { FileTransport } from "./FileTransport";
import { LoggedOutputChannel } from "./LoggedOutputChannel";
import { SwiftLogger } from "./SwiftLogger";

/**
 * Factory for creating {@link SwiftLogger} instances and output channels that write
 * to log files within the shared extension log directory.
 */
export class SwiftLoggerFactory {
    private _logFolderPath: Promise<string>;

    /**
     * @param logFolderUri URI of the directory where log files will be written.
     * The directory is created if it does not already exist.
     */
    constructor(public readonly logFolderUri: vscode.Uri) {
        this._logFolderPath = this.ensureLogFolderExists(logFolderUri);
    }

    /**
     * Creates a new {@link SwiftLogger} that writes to the given log file.
     *
     * @param logFileName Relative path of the log file within the log directory.
     * @param transports Additional Winston transports to attach to the logger.
     * @returns A configured {@link SwiftLogger} instance.
     * @throws If {@link logFileName} is an absolute path.
     */
    createLogger(logFileName: string, transports: winston.transport[] = []): SwiftLogger {
        if (path.isAbsolute(logFileName)) {
            throw Error(`Log file must be a relative path: "${logFileName}"`);
        }
        return new SwiftLogger([new FileTransport(this.logFilePath(logFileName)), ...transports]);
    }

    /**
     * Creates a VS Code output channel that mirrors its output to a log file.
     *
     * @param name Display name of the output channel.
     * @param logFileName Relative path of the log file within the log directory.
     * @returns A {@link vscode.OutputChannel} backed by a log file.
     * @throws If {@link logFileName} is an absolute path.
     */
    createOutputChannel(name: string, logFileName: string): vscode.OutputChannel {
        if (path.isAbsolute(logFileName)) {
            throw Error(`Log file must be a relative path: "${logFileName}"`);
        }
        return new LoggedOutputChannel(name, this.logFilePath(logFileName));
    }

    private async ensureLogFolderExists(logFolderUri: vscode.Uri): Promise<string> {
        await fs.mkdir(logFolderUri.fsPath, { recursive: true });
        return logFolderUri.fsPath;
    }

    private async logFilePath(logFilename: string): Promise<string> {
        const logFolderPath = await this._logFolderPath;
        return path.join(logFolderPath, logFilename);
    }
}
