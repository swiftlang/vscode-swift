//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import { expect } from "chai";
import * as mockFS from "mock-fs";
import * as vscode from "vscode";

suite("mock-fs example", () => {
    // This teardown step is also important to make sure your tests clean up the
    // mocked file system when they complete!
    teardown(() => {
        mockFS.restore();
    });

    test("mock out a file on disk", async () => {
        // A single function call can be used to configure the file system
        mockFS({
            "/path/to/some/file": "Some really cool file contents",
        });
        expect(
            Buffer.from(
                await vscode.workspace.fs.readFile(vscode.Uri.file("/path/to/some/file"))
            ).toString("utf-8")
        ).to.equal("Some really cool file contents");
    });

    test("file is not readable by the current user", async () => {
        mockFS({ "/path/to/file": mockFS.file({ mode: 0o000 }) });
        await expect(vscode.workspace.fs.readFile(vscode.Uri.file("/path/to/file"))).to.eventually
            .be.rejected;
    });
});
