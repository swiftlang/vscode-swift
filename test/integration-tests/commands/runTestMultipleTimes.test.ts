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
import { expect } from "chai";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { TestKind } from "@src/TestExplorer/TestKind";
import { TestRunProxy } from "@src/TestExplorer/TestRunner";
import { runTestMultipleTimes } from "@src/commands/testMultipleTimes";

import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

suite("Test Multiple Times Command Test Suite", () => {
    let folderContext: FolderContext;
    let testItem: vscode.TestItem;

    activateExtensionForSuite({
        async setup(ctx) {
            folderContext = await folderInRootWorkspace("defaultPackage", ctx);
            const testExplorer = await folderContext.resolvedTestExplorer;

            const item = testExplorer.controller.createTestItem("testId", "Test Item For Testing");

            expect(item).to.not.be.undefined;
            testItem = item!;
        },
    });

    test("Runs successfully after testing 0 times", async () => {
        const runState = await runTestMultipleTimes(
            folderContext,
            [testItem],
            false,
            TestKind.standard,
            0
        );
        expect(runState).to.be.an("array").that.is.empty;
    });

    test("Runs successfully after testing 3 times", async () => {
        const runState = await runTestMultipleTimes(
            folderContext,
            [testItem],
            false,
            TestKind.standard,
            3,
            () => Promise.resolve(TestRunProxy.initialTestRunState())
        );

        expect(runState).to.deep.equal([
            TestRunProxy.initialTestRunState(),
            TestRunProxy.initialTestRunState(),
            TestRunProxy.initialTestRunState(),
        ]);
    });

    test("Stops after a failure on the 2nd iteration ", async () => {
        const failure = {
            ...TestRunProxy.initialTestRunState(),
            failed: [{ test: testItem, message: new vscode.TestMessage("oh no") }],
        };
        let ctr = 0;
        const runState = await runTestMultipleTimes(
            folderContext,
            [testItem],
            true,
            TestKind.standard,
            3,
            () => {
                ctr += 1;
                if (ctr === 2) {
                    return Promise.resolve(failure);
                }
                return Promise.resolve(TestRunProxy.initialTestRunState());
            }
        );

        expect(runState).to.deep.equal([TestRunProxy.initialTestRunState(), failure]);
    });
});
