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
import { WriteStream, createWriteStream } from "fs";

import { Disposable } from "../utilities/Disposable";

export class FileWriteStream implements Disposable {
    private isDisposed: boolean = false;
    private fileHandle: WriteStream | null = null;
    private fileHandleError: unknown | null = null;
    private pendingWrites: { data: string; resolve(): void; reject(error: unknown): void }[] = [];

    constructor(private readonly filePath: Promise<string>) {
        void this.initializeFile();
    }

    private async initializeFile(): Promise<void> {
        try {
            const filePath = await this.filePath;
            const fileHandle = createWriteStream(filePath, { flags: "a" });
            fileHandle.on("ready", () => {
                if (this.isDisposed) {
                    fileHandle.close();
                    return;
                }
                this.fileHandle = fileHandle;
                this.flushPendingLogs();
            });
            fileHandle.on("error", error => {
                this.fileHandle = null;
                this.fileHandleError = Error(`FileWriteStream failed to write to "${filePath}"`, {
                    cause: error,
                });
                this.flushPendingLogs();
            });
        } catch (error) {
            this.fileHandle = null;
            this.fileHandleError = error;
            this.flushPendingLogs();
        }
    }

    private flushPendingLogs(): void {
        if (this.pendingWrites.length === 0) {
            return;
        }
        for (const log of this.pendingWrites) {
            if (this.fileHandleError) {
                log.reject(this.fileHandleError);
                continue;
            }
            if (this.fileHandle) {
                this.fileHandle.write(log.data, error => {
                    if (error) {
                        log.reject(error);
                        return;
                    }
                    log.resolve();
                });
            }
        }
        this.pendingWrites = [];
    }

    write(data: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.isDisposed) {
                reject(Error("FileWriteStream has been disposed."));
                return;
            }

            if (this.fileHandleError) {
                reject(this.fileHandleError);
                return;
            }

            if (!this.fileHandle) {
                this.pendingWrites.push({ data, resolve, reject });
                return;
            }

            this.fileHandle.write(data, error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }

    public dispose(): void {
        if (this.isDisposed) {
            return;
        }

        this.isDisposed = true;
        this.fileHandle?.end();
        this.fileHandle?.close();
        this.fileHandle = null;
        this.pendingWrites.forEach(({ reject }) =>
            reject(Error("FileWriteStream has been disposed."))
        );
        this.pendingWrites = [];
    }
}
