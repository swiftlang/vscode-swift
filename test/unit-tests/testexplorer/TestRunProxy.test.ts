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
import { TestClass, runnableTag } from "@src/TestExplorer/TestDiscovery";
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

    suite("addParameterizedTestCase()", () => {
        function testClass(id: string, index: number): TestClass {
            return {
                id,
                label: id,
                tags: [],
                children: [],
                style: "swift-testing",
                location: undefined,
                disabled: true,
                sortText: `${index}`.padStart(8, "0"),
            };
        }

        function setup() {
            const target = createTestItem("Target");
            const suiteItem = createTestItem("Suite", target);
            const parent = createTestItem("parameterized", suiteItem);
            parent.tags = [runnableTag, new vscode.TestTag("swift-testing")];
            const requestedItems = [target, suiteItem, parent];
            const proxy = createProxy(requestedItems);
            proxy.testRunStarted();
            return { target, suiteItem, parent, requestedItems, proxy };
        }

        test("Adds the argument as a child of the parent", () => {
            const { parent, proxy } = setup();

            proxy.addParameterizedTestCase(testClass("arg-0", 0), 2);

            expect(parent.children.size).to.equal(1);
        });

        test("Appends rather than replacing previously added arguments", () => {
            const { parent, proxy } = setup();

            proxy.addParameterizedTestCase(testClass("arg-0", 0), 2);
            proxy.addParameterizedTestCase(testClass("arg-1", 1), 2);

            expect(parent.children.size).to.equal(2);
        });

        test("Returns an index that resolves back to the added item", () => {
            const { proxy } = setup();

            const index = proxy.addParameterizedTestCase(testClass("arg-0", 0), 2);

            expect(index).to.not.be.undefined;
            expect(proxy.testItems[index!].id).to.equal("arg-0");
        });

        test("The added item is findable by id straight away", () => {
            const { proxy } = setup();

            const index = proxy.addParameterizedTestCase(testClass("arg-0", 0), 2);

            expect(proxy.getTestIndex("arg-0")).to.equal(index);
        });

        test("Arguments inherit the parent's tags but are not runnable", () => {
            const { parent, proxy } = setup();

            proxy.addParameterizedTestCase(testClass("arg-0", 0), 2);

            const tagIds = (parent.children.get("arg-0")?.tags ?? []).map(t => t.id);
            expect(tagIds).to.contain("swift-testing");
            expect(tagIds).to.contain(TestRunProxy.Tags.PARAMETERIZED_TEST_RESULT);
            expect(tagIds).to.not.contain(runnableTag.id);
        });

        test("Added arguments are appended to the run's test items and enqueued", () => {
            const { parent, proxy } = setup();
            const before = proxy.testItems.length;

            proxy.addParameterizedTestCase(testClass("arg-0", 0), 2);

            expect(proxy.testItems).to.have.lengthOf(before + 1);
            expect(proxy.runState.enqueued.has(parent.children.get("arg-0")!)).to.be.true;
        });

        test("An unknown parent is reported rather than throwing", () => {
            const { proxy } = setup();

            expect(proxy.addParameterizedTestCase(testClass("arg-0", 0), -1)).to.be.undefined;
        });

        test("The test items the run was asked for are left alone", () => {
            const { requestedItems, proxy } = setup();

            proxy.addParameterizedTestCase(testClass("arg-0", 0), 2);

            expect(requestedItems).to.have.lengthOf(3);
        });

        test("clearParameterizedTestCases discards rows from a previous run", () => {
            const { parent, proxy } = setup();
            proxy.addParameterizedTestCase(testClass("arg-0", 0), 2);

            proxy.clearParameterizedTestCases(2);

            expect(parent.children.size).to.equal(0);
        });
    });
});
