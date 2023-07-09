//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import * as Stream from "stream";
import {
    execFileStreamOutput,
    getRepositoryName,
    getSwiftExecutable,
    isPathInsidePath,
    execSwift,
} from "../../src/utilities/utilities";

suite("Utilities Test Suite", () => {
    test("getRepositoryName", () => {
        // Regular case.
        assert.strictEqual(
            getRepositoryName("https://github.com/swift-server/vscode-swift.git"),
            "vscode-swift"
        );
        // URL does not end in .git.
        assert.strictEqual(
            getRepositoryName("https://github.com/swift-server/vscode-swift"),
            "vscode-swift"
        );
        // URL contains a trailing slash.
        assert.strictEqual(
            getRepositoryName("https://github.com/swift-server/vscode-swift.git/"),
            "vscode-swift"
        );
        // Name contains a dot.
        assert.strictEqual(
            getRepositoryName("https://github.com/swift-server/vscode.swift.git"),
            "vscode.swift"
        );
        // Name contains .git.
        assert.strictEqual(
            getRepositoryName("https://github.com/swift-server/vscode.git.git"),
            "vscode.git"
        );
    });

    test("isPathInsidePath", () => {
        assert(isPathInsidePath("/home/user/package", "/home/user/"));
        assert(isPathInsidePath("/home/user/package/test", "/home/user/"));
        assert(isPathInsidePath("/home/user/", "/home/user/"));
        assert(isPathInsidePath("/home/user/.build", "/home/user/"));
        assert(!isPathInsidePath("/home/user/package", "/home/user/package2"));
        assert(!isPathInsidePath("/home/user/package/.build", "/home/user/package2/.build"));
        assert(!isPathInsidePath("/home/user/package/", "/home/user/package/.build"));
    });

    test("execFileStreamOutput", async () => {
        const swift = await getSwiftExecutable();
        let result = "";
        // Use WriteStream to log results
        const writeStream = new Stream.Writable();
        writeStream._write = (chunk, encoding, next) => {
            const text = chunk.toString("utf8");
            result += text;
            next();
        };
        writeStream.on("close", () => {
            writeStream.end();
        });

        const { stdout } = await execSwift(["--version"], "default");
        await execFileStreamOutput(swift, ["--version"], writeStream, null, null);
        assert(result.length > 0);
        assert(result.includes("Swift version"));
        assert.strictEqual(result, stdout);
    });
});
