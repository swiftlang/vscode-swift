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
import { anything, when } from "ts-mockito";
import { runTestMultipleTimes } from "../../../src/commands/testMultipleTimes";
import { mockNamespace } from "../../unit-tests/MockUtils";
import { FolderContext } from "../../../src/FolderContext";
import { TestRunProxy } from "../../../src/TestExplorer/TestRunner";
import { folderContextPromise } from "../extension.test";

suite("Test Multiple Times Command Test Suite", () => {
    const windowMock = mockNamespace(vscode, "window");

    let folderContext: FolderContext;
    let testItem: vscode.TestItem;

    suiteSetup(async () => {
        folderContext = await folderContextPromise("diagnostics");
        folderContext.addTestExplorer();

        const item = folderContext.testExplorer?.controller.createTestItem(
            "testId",
            "Test Item For Testing"
        );

        assert.ok(item);
        testItem = item;
    });

    test("Runs successfully after testing 0 times", async () => {
        when(windowMock.showInputBox(anything())).thenReturn(Promise.resolve("0"));
        const runState = await runTestMultipleTimes(folderContext, testItem, false);
        assert.deepStrictEqual(runState, []);
    });

    test("Runs successfully after testing 3 times", async () => {
        when(windowMock.showInputBox(anything())).thenReturn(Promise.resolve("3"));

        const runState = await runTestMultipleTimes(folderContext, testItem, false, () =>
            Promise.resolve(TestRunProxy.initialTestRunState())
        );

        assert.deepStrictEqual(runState, [
            TestRunProxy.initialTestRunState(),
            TestRunProxy.initialTestRunState(),
            TestRunProxy.initialTestRunState(),
        ]);
    });

    test("Stops after a failure on the 2nd iteration ", async () => {
        when(windowMock.showInputBox(anything())).thenReturn(Promise.resolve("3"));

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

        assert.deepStrictEqual(runState, [TestRunProxy.initialTestRunState(), failure]);
    });
});
