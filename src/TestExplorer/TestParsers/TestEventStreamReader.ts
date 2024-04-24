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
            fs.open(this.path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK, (err, fd) => {
                try {
                    const pipe = new net.Socket({ fd, readable: true });
                    pipe.on("data", data => readable.push(data));
                    pipe.on("error", () => fs.close(fd));
                    pipe.on("end", () => {
                        readable.push(null);
                        fs.close(fd);
                    });

                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
    }
}
