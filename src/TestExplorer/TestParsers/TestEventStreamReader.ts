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
import { Readable } from "stream";
import { promisify } from "util";

import { SwiftLogger } from "../../logging/SwiftLogger";

const openAsync = promisify(fs.open);

export interface INamedPipeReader {
    start(readable: Readable): Promise<void>;
    stop(): Promise<void>;
}

/**
 * Reads from a named pipe on Windows and forwards data to a `Readable` stream.
 * Note that the path must be in the Windows named pipe format of `\\.\pipe\pipename`.
 */
export class WindowsNamedPipeReader implements INamedPipeReader {
    private server?: net.Server;
    private readable?: Readable;

    constructor(
        private path: string,
        private logger?: SwiftLogger
    ) {}

    public async start(readable: Readable) {
        this.readable = readable;
        return new Promise<void>((resolve, reject) => {
            try {
                // `swift test` w/ swift-testing tests launches one test target subprocess at a time.
                // Each one opens a fresh connection to the named pipe, writes its events, and
                // closes. The server must keep listening across connections so that
                // every target's events reach the parser.
                const server = net.createServer(stream => {
                    stream.on("data", data => readable.push(data));
                    stream.on("error", err => {
                        this.logger?.warn(`swift-testing pipe connection error: ${err.message}`);
                    });
                });
                this.server = server;
                server.listen(this.path, () => resolve());
            } catch (error) {
                reject(error);
            }
        });
    }

    public async stop(): Promise<void> {
        const server = this.server;
        const readable = this.readable;
        this.server = undefined;
        this.readable = undefined;
        if (server) {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
        readable?.push(null);
    }
}

/**
 * Reads from a unix FIFO pipe and forwards data to a `Readable` stream.
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

    public async start(readable: Readable) {
        const guardFd = await openAsync(this.path, fs.constants.O_RDWR);
        this.guardFd = guardFd;

        // With the guard writer held open, the dedicated read fd can be
        // opened without blocking and will receive EOF only when we
        // explicitly close the guard in `stop()`.
        let readFd: number;
        try {
            readFd = await openAsync(this.path, fs.constants.O_RDONLY);
        } catch (error) {
            fs.close(guardFd, () => {});
            this.guardFd = undefined;
            throw error;
        }

        // Using a net.Socket to read the pipe has an 8kb internal buffer,
        // meaning we couldn't read from writes that were > 8kb.
        const pipe = fs.createReadStream("", { fd: readFd, autoClose: true });
        this.pipe = pipe;
        pipe.on("data", data => {
            if (!readable.push(data)) {
                pipe.pause();
            }
        });
        readable.on("drain", () => pipe.resume());
        pipe.on("error", err => {
            this.logger?.warn(`swift-testing pipe read error: ${err.message}`);
        });
        pipe.on("end", () => {
            readable.push(null);
        });
    }

    public async stop(): Promise<void> {
        const guardFd = this.guardFd;
        const pipe = this.pipe;
        this.guardFd = undefined;
        this.pipe = undefined;
        if (guardFd === undefined) {
            return;
        }

        // Dropping the guard writer lets the kernel deliver EOF to the read
        // fd, which triggers the stream's "end" handler above and closes the
        // read fd via autoClose. We wait for both the guard close and the
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
    }
}
