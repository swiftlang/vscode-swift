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
import * as assert from "assert";
import { execFile } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import { afterEach, beforeEach } from "mocha";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import { promisify } from "util";

import { UnixNamedPipeReader } from "@src/TestExplorer/TestParsers/TestEventStreamReader";

const execFileAsync = promisify(execFile);

suite("UnixNamedPipeReader Suite", () => {
    let fifoPath: string;

    beforeEach(async function () {
        if (process.platform === "win32") {
            this.skip();
            return;
        }
        fifoPath = path.join(
            os.tmpdir(),
            `vscode-swift-test-fifo-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`
        );
        await execFileAsync("mkfifo", [fifoPath]);
    });

    afterEach(() => {
        if (fifoPath && fs.existsSync(fifoPath)) {
            fs.unlinkSync(fifoPath);
        }
    });

    function collectData(readable: Readable): Promise<string> {
        return new Promise(resolve => {
            let out = "";
            readable.on("data", chunk => {
                out += chunk.toString();
            });
            readable.on("end", () => resolve(out));
        });
    }

    async function writeAndClose(filePath: string, data: string): Promise<void> {
        await fs.promises.writeFile(filePath, data);
    }

    test("delivers data from a single writer", async () => {
        const reader = new UnixNamedPipeReader(fifoPath);
        const readable = new Readable({ read() {} });
        const collected = collectData(readable);

        await reader.start(readable);
        await writeAndClose(fifoPath, "hello\n");
        await reader.stop();

        const result = await collected;
        assert.strictEqual(result, "hello\n");
    });

    test("delivers data from multiple sequential writers without blocking", async () => {
        // Regression test for the "first suite runs, then hangs" bug.
        // `swift test` spawns one subprocess per test target, each opens/writes/closes
        // the shared FIFO in sequence. Without a persistent writer reference on the
        // reader's side the first writer's EOF tears the reader down, and the second
        // writer blocks forever on open().
        const reader = new UnixNamedPipeReader(fifoPath);
        const readable = new Readable({ read() {} });
        const collected = collectData(readable);

        await reader.start(readable);

        await writeAndClose(fifoPath, "suite-1\n");
        await writeAndClose(fifoPath, "suite-2\n");
        await writeAndClose(fifoPath, "suite-3\n");

        await reader.stop();

        const result = await collected;
        assert.strictEqual(result, "suite-1\nsuite-2\nsuite-3\n");
    });

    test("stop() terminates the readable with EOF", async () => {
        const reader = new UnixNamedPipeReader(fifoPath);
        const readable = new Readable({ read() {} });

        await reader.start(readable);

        const endPromise = new Promise<void>(resolve => readable.on("end", () => resolve()));
        readable.on("data", () => {});
        await reader.stop();

        await endPromise;
    });

    test("stop() resolves only after buffered data has drained", async () => {
        const reader = new UnixNamedPipeReader(fifoPath);
        const readable = new Readable({ read() {} });
        const collected = collectData(readable);

        await reader.start(readable);
        await writeAndClose(fifoPath, "trailing\n");

        // stop() must not resolve until the kernel has delivered EOF and the
        // read stream has drained. After it resolves, all data should be visible.
        await reader.stop();

        const result = await collected;
        assert.strictEqual(result, "trailing\n");
    });
});
