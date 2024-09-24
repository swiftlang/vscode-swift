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
import { expect } from "chai";
import { runTestMultipleTimes } from "../../../src/commands/testMultipleTimes";
import { mockGlobalObject } from "../../MockUtils";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { FolderContext } from "../../../src/FolderContext";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";
import { testAssetWorkspaceFolder } from "../../fixtures";
import { TestRunProxy } from "../../../src/TestExplorer/TestRunner";

suite("Test Multiple Times Command Test Suite", () => {
    const windowMock = mockGlobalObject(vscode, "window");

    let folderContext: FolderContext;
    let testItem: vscode.TestItem;

    suiteSetup(async () => {
        const toolchain = await SwiftToolchain.create();
        const workspaceContext = await WorkspaceContext.create(
            new SwiftOutputChannel("Swift"),
            toolchain
        );
        const workspaceFolder = testAssetWorkspaceFolder("diagnostics");
        folderContext = await workspaceContext.addPackageFolder(
            workspaceFolder.uri,
            workspaceFolder
        );
        folderContext.addTestExplorer();

        const item = folderContext.testExplorer?.controller.createTestItem(
            "testId",
            "Test Item For Testing"
        );

        expect(item).to.not.be.undefined;
        testItem = item!;
    });

    test("Runs successfully after testing 0 times", async () => {
        windowMock.showInputBox.resolves("0");
        const runState = await runTestMultipleTimes(folderContext, testItem, false);
        expect(runState).to.be.an("array").that.is.empty;
    });

    test("Runs successfully after testing 3 times", async () => {
        windowMock.showInputBox.resolves("3");

        const runState = await runTestMultipleTimes(folderContext, testItem, false, () =>
            Promise.resolve(TestRunProxy.initialTestRunState())
        );

        expect(runState).to.deep.equal([
            TestRunProxy.initialTestRunState(),
            TestRunProxy.initialTestRunState(),
            TestRunProxy.initialTestRunState(),
        ]);
    });

    test("Stops after a failure on the 2nd iteration ", async () => {
        windowMock.showInputBox.resolves("3");

        const failure = {
            ...TestRunProxy.initialTestRunState(),
            failed: [{ test: testItem, message: new vscode.TestMessage("oh no") }],
        };
        let ctr = 0;
        const runState = await runTestMultipleTimes(folderContext, testItem, true, () => {
            ctr += 1;
            if (ctr === 2) {
                return Promise.resolve(failure);
            }
            return Promise.resolve(TestRunProxy.initialTestRunState());
        });

        expect(runState).to.deep.equal([TestRunProxy.initialTestRunState(), failure]);
    });
});
