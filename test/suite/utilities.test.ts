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
    ArgumentFilter,
    execFileStreamOutput,
    filterArguments,
    getRepositoryName,
    getSwiftExecutable,
    isPathInsidePath,
    buildPathFlags,
    buildDirectoryFromWorkspacePath,
    execSwift,
} from "../../src/utilities/utilities";
import * as vscode from "vscode";

suite("Utilities Test Suite", () => {
    suiteTeardown(async () => {
        await vscode.workspace.getConfiguration("swift").update("buildPath", undefined);
    });

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

        const { stdout } = await execSwift(["--version"]);
        await execFileStreamOutput(swift, ["--version"], writeStream, null, null);
        assert(result.length > 0);
        assert(result.includes("Swift version"));
        assert.strictEqual(result, stdout);
    });

    test("filterArguments", () => {
        const argumentFilter: ArgumentFilter[] = [
            { argument: "-one", include: 1 },
            { argument: "-1", include: 1 },
            { argument: "-zero", include: 0 },
            { argument: "-two", include: 2 },
        ];
        assert.notStrictEqual(filterArguments(["-test", "this"], argumentFilter), []);
        assert.notStrictEqual(filterArguments(["-test", "-zero"], argumentFilter), ["-zero"]);
        assert.notStrictEqual(filterArguments(["-one", "inc1", "test"], argumentFilter), [
            "-one",
            "inc1",
        ]);
        assert.notStrictEqual(filterArguments(["-two", "inc1", "inc2"], argumentFilter), [
            "-one",
            "inc1",
            "inc2",
        ]);
        assert.notStrictEqual(
            filterArguments(["-ignore", "-one", "inc1", "test"], argumentFilter),
            ["-one", "inc1"]
        );
        assert.notStrictEqual(
            filterArguments(["-one", "inc1", "test", "-1", "inc2"], argumentFilter),
            ["-one", "inc1", "-1", "inc2"]
        );
        assert.notStrictEqual(filterArguments(["-one=1", "-zero=0", "-one1=1"], argumentFilter), [
            "-one=1",
        ]);
    });

    test("buildPathFlags", async () => {
        // no configuration provided - fallback
        await vscode.workspace.getConfiguration("swift").update("buildPath", undefined);

        assert.deepStrictEqual(buildPathFlags(), []);

        await vscode.workspace.getConfiguration("swift").update("buildPath", "");

        assert.deepStrictEqual(buildPathFlags(), []);

        // configuration provided
        await vscode.workspace
            .getConfiguration("swift")
            .update("buildPath", "/some/other/full/test/path");

        assert.deepStrictEqual(buildPathFlags(), ["--build-path", "/some/other/full/test/path"]);
    });

    test("buildDirectoryFromWorkspacePath", async () => {
        // no configuration provided - fallback
        await vscode.workspace.getConfiguration("swift").update("buildPath", undefined);

        assert.strictEqual(
            buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false),
            ".build"
        );

        assert.strictEqual(
            buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true),
            "/some/full/workspace/test/path/.build"
        );

        await vscode.workspace.getConfiguration("swift").update("buildPath", "");

        assert.strictEqual(
            buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false),
            ".build"
        );

        assert.strictEqual(
            buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true),
            "/some/full/workspace/test/path/.build"
        );

        // configuration provided
        await vscode.workspace
            .getConfiguration("swift")
            .update("buildPath", "/some/other/full/test/path");

        assert.strictEqual(
            buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false),
            "/some/other/full/test/path"
        );

        assert.strictEqual(
            buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true),
            "/some/other/full/test/path"
        );

        await vscode.workspace
            .getConfiguration("swift")
            .update("buildPath", "some/relative/test/path");

        assert.strictEqual(
            buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false),
            "some/relative/test/path"
        );

        assert.strictEqual(
            buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true),
            "/some/full/workspace/test/path/some/relative/test/path"
        );
    });
});
