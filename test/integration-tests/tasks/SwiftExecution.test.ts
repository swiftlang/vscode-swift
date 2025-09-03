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

import * as vscode from "vscode";
import * as assert from "assert";
import { testSwiftTask } from "../../fixtures";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { executeTaskAndWaitForResult, waitForStartTaskProcess } from "../../utilities/tasks";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { activateExtensionForSuite } from "../utilities/testutilities";

suite("SwiftExecution Tests Suite", () => {
    let workspaceContext: WorkspaceContext;
    let toolchain: SwiftToolchain;
    let workspaceFolder: vscode.WorkspaceFolder;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            toolchain = await SwiftToolchain.create();
            assert.notEqual(workspaceContext.folders.length, 0);
            workspaceFolder = workspaceContext.folders[0].workspaceFolder;
        },
    });

    test("Close event handler fires", async () => {
        const fixture = testSwiftTask("swift", ["build"], workspaceFolder, toolchain);
        const promise = executeTaskAndWaitForResult(fixture);
        fixture.process.close(1);
        const { exitCode } = await promise;
        assert.equal(exitCode, 1);
    });

    test("Write event handler fires", async () => {
        const fixture = testSwiftTask("swift", ["build"], workspaceFolder, toolchain);
        const startPromise = waitForStartTaskProcess(fixture.task);
        const promise = executeTaskAndWaitForResult(fixture);
        await startPromise;
        fixture.process.write("Fetching some dependency");
        fixture.process.write("[5/7] Building main.swift");
        fixture.process.write("Build complete");
        fixture.process.close(0);
        const { output } = await promise;
        assert.equal(
            output,
            "Fetching some dependency\n[5/7] Building main.swift\nBuild complete\n"
        );
    });
});
