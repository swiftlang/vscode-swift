//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2023 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import * as vscode from "vscode";
import { SwiftToolchain } from "../../src/toolchain/toolchain";
import { ArgumentFilter, BuildFlags } from "../../src/toolchain/BuildFlags";
import { Version } from "../../src/utilities/version";

suite("BuildFlags Test Suite", () => {
    let toolchain: SwiftToolchain;
    let buildFlags: BuildFlags;

    suiteSetup(async () => {
        toolchain = await SwiftToolchain.create();
        buildFlags = toolchain.buildFlags;
    });

    test("buildPathFlags", async () => {
        // no configuration provided - fallback
        await vscode.workspace.getConfiguration("swift").update("buildPath", undefined);

        assert.deepStrictEqual(buildFlags.buildPathFlags(), []);

        await vscode.workspace.getConfiguration("swift").update("buildPath", "");

        assert.deepStrictEqual(buildFlags.buildPathFlags(), []);

        // configuration provided
        await vscode.workspace
            .getConfiguration("swift")
            .update("buildPath", "/some/other/full/test/path");

        if (toolchain.swiftVersion < new Version(5, 8, 0)) {
            assert.deepStrictEqual(buildFlags.buildPathFlags(), [
                "--build-path",
                "/some/other/full/test/path",
            ]);
        } else {
            assert.deepStrictEqual(buildFlags.buildPathFlags(), [
                "--scratch-path",
                "/some/other/full/test/path",
            ]);
        }
    }).timeout(5000);

    test("buildDirectoryFromWorkspacePath", async () => {
        // no configuration provided - fallback
        await vscode.workspace.getConfiguration("swift").update("buildPath", undefined);

        assert.strictEqual(
            BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false),
            ".build"
        );

        assert.strictEqual(
            BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true),
            "/some/full/workspace/test/path/.build"
        );

        await vscode.workspace.getConfiguration("swift").update("buildPath", "");

        assert.strictEqual(
            BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false),
            ".build"
        );

        assert.strictEqual(
            BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true),
            "/some/full/workspace/test/path/.build"
        );

        // configuration provided
        await vscode.workspace
            .getConfiguration("swift")
            .update("buildPath", "/some/other/full/test/path");

        assert.strictEqual(
            BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false),
            "/some/other/full/test/path"
        );

        assert.strictEqual(
            BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true),
            "/some/other/full/test/path"
        );

        await vscode.workspace
            .getConfiguration("swift")
            .update("buildPath", "some/relative/test/path");

        assert.strictEqual(
            BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false),
            "some/relative/test/path"
        );

        assert.strictEqual(
            BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true),
            "/some/full/workspace/test/path/some/relative/test/path"
        );
    });

    test("filterArguments", () => {
        const argumentFilter: ArgumentFilter[] = [
            { argument: "-one", include: 1 },
            { argument: "-1", include: 1 },
            { argument: "-zero", include: 0 },
            { argument: "-two", include: 2 },
        ];
        assert.notStrictEqual(BuildFlags.filterArguments(["-test", "this"], argumentFilter), []);
        assert.notStrictEqual(BuildFlags.filterArguments(["-test", "-zero"], argumentFilter), [
            "-zero",
        ]);
        assert.notStrictEqual(
            BuildFlags.filterArguments(["-one", "inc1", "test"], argumentFilter),
            ["-one", "inc1"]
        );
        assert.notStrictEqual(
            BuildFlags.filterArguments(["-two", "inc1", "inc2"], argumentFilter),
            ["-one", "inc1", "inc2"]
        );
        assert.notStrictEqual(
            BuildFlags.filterArguments(["-ignore", "-one", "inc1", "test"], argumentFilter),
            ["-one", "inc1"]
        );
        assert.notStrictEqual(
            BuildFlags.filterArguments(["-one", "inc1", "test", "-1", "inc2"], argumentFilter),
            ["-one", "inc1", "-1", "inc2"]
        );
        assert.notStrictEqual(
            BuildFlags.filterArguments(["-one=1", "-zero=0", "-one1=1"], argumentFilter),
            ["-one=1"]
        );
    });
}).timeout(5000);
