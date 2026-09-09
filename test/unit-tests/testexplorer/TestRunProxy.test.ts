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
import { afterEach, beforeEach } from "mocha";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { TestRunArguments } from "@src/TestExplorer/TestRunArguments";
import { TestRunProxy } from "@src/TestExplorer/TestRunProxy";

import { instance, mockObject } from "../../MockUtils";

suite("TestRunProxy Unit Test Suite", () => {
    let controller: vscode.TestController;
    let controllerId = 0;

    beforeEach(() => {
        controllerId += 1;
        controller = vscode.tests.createTestController(
            `test-run-proxy-${controllerId}`,
            "TestRunProxy Tests"
        );
    });

    afterEach(() => {
        controller.dispose();
    });

    function createTestItem(id: string, parent?: vscode.TestItem): vscode.TestItem {
        const item = controller.createTestItem(id, id);
        (parent?.children ?? controller.items).add(item);
        return item;
    }

    function createProxy(testItems: vscode.TestItem[]): TestRunProxy {
        const request = new vscode.TestRunRequest(testItems);
        const args = mockObject<TestRunArguments>({ testItems });
        const folderContext = mockObject<FolderContext>({});
        return new TestRunProxy(
            request,
            controller,
            instance(args),
            instance(folderContext),
            false,
            new vscode.CancellationTokenSource().token
        );
    }

    suite("enqueued state propagation", () => {
        test("A parent stays enqueued while any of its children are still enqueued", () => {
            const suiteItem = createTestItem("Suite");
            const first = createTestItem("first", suiteItem);
            const second = createTestItem("second", suiteItem);
            const proxy = createProxy([suiteItem, first, second]);
            proxy.testRunStarted();

            proxy.started(first);

            expect(proxy.runState.enqueued).to.contain(suiteItem);
            expect(proxy.runState.enqueued).to.contain(second);
            expect(proxy.runState.enqueued).to.not.contain(first);
        });

        test("A parent is dequeued once every child has left the enqueued state", () => {
            const suiteItem = createTestItem("Suite");
            const first = createTestItem("first", suiteItem);
            const second = createTestItem("second", suiteItem);
            const proxy = createProxy([suiteItem, first, second]);
            proxy.testRunStarted();

            proxy.started(first);
            proxy.started(second);

            expect(proxy.runState.enqueued).to.be.empty;
        });

        test("Dequeuing the last leaf dequeues every ancestor", () => {
            const target = createTestItem("Target");
            const suiteItem = createTestItem("Suite", target);
            const testItem = createTestItem("test", suiteItem);
            const proxy = createProxy([target, suiteItem, testItem]);
            proxy.testRunStarted();

            proxy.started(testItem);

            expect(proxy.runState.enqueued).to.be.empty;
        });

        test("A child leaving the enqueued state twice does not dequeue its siblings", () => {
            const suiteItem = createTestItem("Suite");
            const first = createTestItem("first", suiteItem);
            const second = createTestItem("second", suiteItem);
            const proxy = createProxy([suiteItem, first, second]);
            proxy.testRunStarted();

            proxy.started(first);
            proxy.passed(first);

            expect(proxy.runState.enqueued).to.contain(suiteItem);
            expect(proxy.runState.enqueued).to.contain(second);
        });
    });
});
