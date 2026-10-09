//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as fs from "fs";
import * as net from "net";
import { PassThrough } from "stream";
import { promisify } from "util";

import { SwiftLogger } from "../../logging/SwiftLogger";

const openAsync = promisify(fs.open);
const label = "TestEventStreamReader";

export interface INamedPipeReader {
    start(destination: PassThrough): Promise<void>;
    stop(): Promise<void>;
}

/**
 * Reads from a named pipe on Windows and forwards data to a `PassThrough` stream.
 * Note that the path must be in the Windows named pipe format of `\\.\pipe\pipename`.
 */
export class WindowsNamedPipeReader implements INamedPipeReader {
    private server?: net.Server;
    private destination?: PassThrough;

    constructor(
        private path: string,
        private logger?: SwiftLogger
    ) {}

    public async start(destination: PassThrough) {
        this.destination = destination;
        return new Promise<void>((resolve, reject) => {
            try {
                // `swift test` w/ swift-testing tests launches one test target subprocess at a time.
                // Each one opens a fresh connection to the named pipe, writes its events, and
                // closes. The server must keep listening across connections so that
                // every target's events reach the parser.
                let connections = 0;
                const server = net.createServer(stream => {
                    const connection = ++connections;
                    this.logger?.trace(`swift-testing pipe connection ${connection} opened`, {
                        label,
                    });
                    stream.on("end", () => {
                        this.logger?.trace(`swift-testing pipe connection ${connection} ended`, {
                            label,
                        });
                    });
                    // `end: false` because one target closing its connection must not end the
                    // destination; the targets that follow still have events to write.
                    stream.pipe(destination, { end: false });
                    stream.on("error", err => {
                        this.logger?.warn(`swift-testing pipe connection error: ${err.message}`);
                    });
                });
                this.server = server;
                this.logger?.trace(`Listening on swift-testing pipe ${this.path}`, { label });
                server.listen(this.path, () => {
                    this.logger?.trace(`Listening started on swift-testing pipe ${this.path}`, {
                        label,
                    });
                    resolve();
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    public async stop(): Promise<void> {
        const server = this.server;
        const destination = this.destination;
        this.server = undefined;
        this.destination = undefined;
        this.logger?.trace(
            `Stopping swift-testing pipe server, running=${!!server}, path=${this.path}`,
            { label }
        );
        if (server) {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
        destination?.end();
        this.logger?.trace("Stopped swift-testing pipe server", { label });
    }
}

/**
 * Reads from a unix FIFO pipe and forwards data to a `PassThrough` stream.
 * Note that the pipe at the supplied path should be created with `mkfifo`
 * before calling `start()`.
 */
export class UnixNamedPipeReader implements INamedPipeReader {
    private guardFd?: number;
    private pipe?: fs.ReadStream;

    constructor(
        private path: string,
        private logger?: SwiftLogger
    ) {}

    public async start(destination: PassThrough) {
        this.logger?.trace(`Opening swift-testing FIFO guard fd ${this.path}`, { label });
        const guardFd = await openAsync(this.path, fs.constants.O_RDWR);
        this.guardFd = guardFd;
        this.logger?.trace(`Opened swift-testing FIFO guard fd ${guardFd}`, { label });

        // With the guard writer held open, the dedicated read fd can be
        // opened without blocking and will receive EOF only when we
        // explicitly close the guard in `stop()`.
        let readFd: number;
        try {
            readFd = await openAsync(this.path, fs.constants.O_RDONLY);
        } catch (error) {
            this.logger?.trace(`Failed to open swift-testing FIFO read fd: ${error}`, { label });
            fs.close(guardFd, () => {});
            this.guardFd = undefined;
            throw error;
        }

        // Using a net.Socket to read the pipe has an 8kb internal buffer,
        // meaning we couldn't read from writes that were > 8kb.
        this.logger?.trace(`Opened swift-testing FIFO read fd ${readFd}`, { label });
        const pipe = fs.createReadStream("", { fd: readFd, autoClose: true });
        this.pipe = pipe;
        pipe.once("end", () => {
            this.logger?.trace(`swift-testing FIFO read stream ended ${this.path}`, { label });
        });
        pipe.on("error", err => {
            this.logger?.warn(`swift-testing pipe read error: ${err.message}`);
        });

        // `pipe()` rather than a manual data/pause/resume pair: the destination is writable,
        // so Node pauses and resumes the source off its `drain` event.
        pipe.pipe(destination);
    }

    public async stop(): Promise<void> {
        const guardFd = this.guardFd;
        const pipe = this.pipe;
        this.guardFd = undefined;
        this.pipe = undefined;
        if (guardFd === undefined) {
            this.logger?.trace(`swift-testing FIFO reader not open, nothing to stop`, { label });
            return;
        }
        this.logger?.trace(
            `Stopping swift-testing FIFO reader, closing guard fd ${guardFd}, pipe closed=${pipe?.closed}`,
            { label }
        );

        // Dropping the guard writer lets the kernel deliver EOF to the read
        // fd, which ends the source, closes the read fd via autoClose and ends
        // the destination. We wait for both the guard close and the
        // read stream to fully drain so callers can rely on all buffered
        // events having reached the parser before the FIFO is unlinked.
        const pipeDrained =
            pipe && !pipe.closed
                ? new Promise<void>(resolve => pipe.once("close", () => resolve()))
                : Promise.resolve();

        const guardClosed = new Promise<void>(resolve => {
            fs.close(guardFd, closeErr => {
                if (closeErr) {
                    this.logger?.warn(
                        `Failed to close swift-testing FIFO guard fd: ${closeErr.message}`
                    );
                }
                resolve();
            });
        });

        await Promise.all([guardClosed, pipeDrained]);
        this.logger?.trace(`Stopped swift-testing FIFO reader ${this.path}`, { label });
    }
}
