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

export interface INamedPipeReader {
    start(readable: Readable): Promise<void>;
}

/**
 * Reads from a named pipe on Windows and forwards data to a `Readable` stream.
 * Note that the path must be in the Windows named pipe format of `\\.\pipe\pipename`.
 */
export class WindowsNamedPipeReader implements INamedPipeReader {
    constructor(private path: string) {}

    public async start(readable: Readable) {
        return new Promise<void>((resolve, reject) => {
            try {
                const server = net.createServer(function (stream) {
                    stream.on("data", data => readable.push(data));
                    stream.on("error", () => server.close());
                    stream.on("end", function () {
                        readable.push(null);
                        server.close();
                    });
                });

                server.listen(this.path, () => resolve());
            } catch (error) {
                reject(error);
            }
        });
    }
}

/**
 * Reads from a unix FIFO pipe and forwards data to a `Readable` stream.
 * Note that the pipe at the supplied path should be created with `mkfifo`
 * before calling `start()`.
 */
export class UnixNamedPipeReader implements INamedPipeReader {
    constructor(private path: string) {}

    public async start(readable: Readable) {
        return new Promise<void>((resolve, reject) => {
            fs.open(this.path, fs.constants.O_RDONLY, (err, fd) => {
                if (err) {
                    return reject(err);
                }
                try {
                    // Create our own readable stream that handles backpressure.
                    // Using a net.Socket to read the pipe has an 8kb internal buffer,
                    // meaning we couldn't read from writes that were > 8kb.
                    const pipe = fs.createReadStream("", { fd });

                    pipe.on("data", data => {
                        if (!readable.push(data)) {
                            pipe.pause();
                        }
                    });

                    readable.on("drain", () => pipe.resume());
                    pipe.on("error", () => pipe.close());
                    pipe.on("end", () => {
                        readable.push(null);
                        fs.close(fd);
                    });

                    resolve();
                } catch (error) {
                    fs.close(fd, () => reject(error));
                }
            });
        });
    }
}
