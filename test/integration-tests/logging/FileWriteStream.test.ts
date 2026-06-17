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
import { expect } from "chai";
import * as fs from "fs/promises";

import { FileWriteStream } from "@src/logging/FileWriteStream";
import { TemporaryFolder } from "@src/utilities/tempFolder";
import { unwrapPromise } from "@src/utilities/utilities";

suite("FileWriteStream Integration Test Suite", () => {
    /**
     * Runs the provided task with a generated file path. The file is not created on disk when the task is
     * called, but will be cleaned up after the task runs.
     *
     * @param task A function that returns a Promise.
     */
    async function withTemporaryLogFile(task: (filePath: string) => Promise<void>): Promise<void> {
        const folder = await TemporaryFolder.create();
        const filePath = folder.filename("FileWriteStream-test", "log");
        try {
            await task(filePath);
        } finally {
            await fs.rm(filePath, { force: true }).catch(() => {
                // The file probably didn't get created by the test
            });
        }
    }

    test("streams logs to the provided log file", async () => {
        const { promise: filePathPromise, resolve: resolveFilePath } = unwrapPromise<string>();
        const writeStream = new FileWriteStream(filePathPromise);
        await withTemporaryLogFile(async filePath => {
            resolveFilePath(filePath);
            await Promise.all([
                writeStream.write("This is a"),
                writeStream.write(" set of\n"),
                writeStream.write("writes to the log file"),
            ]);
            await expect(
                fs.readFile(filePath, "utf-8"),
                "Check log file contents"
            ).to.eventually.equal("This is a set of\nwrites to the log file");

            await Promise.all([
                writeStream.write("\n"),
                writeStream.write("This is some more text"),
            ]);
            await expect(
                fs.readFile(filePath, "utf-8"),
                "Check log file contents"
            ).to.eventually.equal(
                "This is a set of\nwrites to the log file\nThis is some more text"
            );
        }).finally(() => writeStream.dispose());
    });

    test("buffers writes before the log file is available", async () => {
        const { promise: filePathPromise, resolve: resolveFilePath } = unwrapPromise<string>();
        const writeStream = new FileWriteStream(filePathPromise);
        await withTemporaryLogFile(async filePath => {
            await Promise.all([
                writeStream.write("This is a"),
                writeStream.write(" set of\n"),
                writeStream.write("writes to the log file"),
                new Promise<void>(resolve =>
                    setTimeout(() => {
                        resolveFilePath(filePath);
                        resolve();
                    }, 500)
                ),
            ]);

            const fileContents = await fs.readFile(filePath, "utf-8");
            expect(fileContents, "Check log file contents").to.equal(
                "This is a set of\nwrites to the log file"
            );
        }).finally(() => writeStream.dispose());
    });

    test("writes are rejected if the filePath Promise is rejected", async () => {
        const { promise: filePathPromise, reject: rejectFilePath } = unwrapPromise<string>();
        const writeStream = new FileWriteStream(filePathPromise);
        await withTemporaryLogFile(async filePath => {
            // Create some pending writes before rejecting the file path Promise
            await Promise.all([
                expect(writeStream.write("first")).to.eventually.be.rejected,
                expect(writeStream.write("second")).to.eventually.be.rejected,
                new Promise<void>(resolve =>
                    setTimeout(() => {
                        rejectFilePath(filePath);
                        resolve();
                    }, 100)
                ),
            ]);
            // Make sure that subsequent writes also fail
            await expect(writeStream.write("third")).to.eventually.be.rejected;
            await expect(writeStream.write("fourth")).to.eventually.be.rejected;
            await expect(writeStream.write("fifth")).to.eventually.be.rejected;
        }).finally(() => writeStream.dispose());
    });

    test("writes are rejected if the stream is disposed", async () => {
        const { promise: filePathPromise, resolve: resolveFilePath } = unwrapPromise<string>();
        const writeStream = new FileWriteStream(filePathPromise);
        await withTemporaryLogFile(async filePath => {
            // Create some pending writes before resolving the file path Promise
            await Promise.all([
                expect(writeStream.write("first")).to.eventually.be.rejected,
                expect(writeStream.write("second")).to.eventually.be.rejected,
                new Promise<void>(resolve =>
                    setTimeout(() => {
                        writeStream.dispose();
                        resolveFilePath(filePath);
                        resolve();
                    }, 100)
                ),
            ]);
            // Make sure that subsequent writes also fail
            await expect(writeStream.write("third")).to.eventually.be.rejected;
            await expect(writeStream.write("fourth")).to.eventually.be.rejected;
            await expect(writeStream.write("fifth")).to.eventually.be.rejected;
        }).finally(() => writeStream.dispose());
    });

    test("writes are rejected after a file handle error", async () => {
        const { promise: filePathPromise, resolve: resolveFilePath } = unwrapPromise<string>();
        const writeStream = new FileWriteStream(filePathPromise);
        try {
            // Create some pending writes before resolving the file path Promise
            await Promise.all([
                expect(writeStream.write("first")).to.eventually.be.rejected,
                expect(writeStream.write("second")).to.eventually.be.rejected,
                new Promise<void>(resolve =>
                    setTimeout(() => {
                        resolveFilePath("/no/such/directory/file.log");
                        resolve();
                    }, 100)
                ),
            ]);
            // Make sure that subsequent writes also fail
            await expect(writeStream.write("third")).to.eventually.be.rejected;
            await expect(writeStream.write("fourth")).to.eventually.be.rejected;
            await expect(writeStream.write("fifth")).to.eventually.be.rejected;
        } finally {
            writeStream.dispose();
        }
    });
});
