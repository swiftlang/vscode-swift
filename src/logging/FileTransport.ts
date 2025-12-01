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
import * as path from "path";
import * as TransportType from "winston-transport";

// Compile error if don't use "require": https://github.com/swiftlang/vscode-swift/actions/runs/16529946578/job/46752753379?pr=1746
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Transport: typeof TransportType = require("winston-transport");

export class FileTransport extends Transport {
    private fileHandle: fs.WriteStream | null = null;
    private pendingLogs: string[] = [];
    private isReady = false;

    constructor(private readonly filePath: string) {
        super();
        this.initializeFile();
    }

    private initializeFile(): void {
        try {
            // Ensure the directory exists
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Create write stream
            this.fileHandle = fs.createWriteStream(this.filePath, { flags: "a" });

            this.fileHandle.on("ready", () => {
                this.isReady = true;
                this.flushPendingLogs();
            });

            this.fileHandle.on("error", error => {
                // eslint-disable-next-line no-console
                console.error(`FileTransport error: ${error}`);
                this.isReady = false;
            });
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(`Failed to initialize FileTransport: ${error}`);
            this.isReady = false;
        }
    }

    private flushPendingLogs(): void {
        if (this.fileHandle && this.pendingLogs.length > 0) {
            for (const log of this.pendingLogs) {
                this.fileHandle.write(log + "\n");
            }
            this.pendingLogs = [];
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public log(info: any, next: () => void): void {
        // Get the formatted message from winston
        const logMessage = info[Symbol.for("message")];

        if (this.isReady && this.fileHandle) {
            this.fileHandle.write(logMessage + "\n");
        } else {
            // Buffer logs if file isn't ready yet
            this.pendingLogs.push(logMessage);
        }

        next();
    }

    public close(): void {
        if (this.fileHandle) {
            this.fileHandle.end();
            this.fileHandle = null;
        }
        this.isReady = false;
        this.pendingLogs = [];
    }
}
