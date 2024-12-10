//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2023 the VS Code Swift project authors
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
import { beforeEach, afterEach } from "mocha";
import { TestRunArguments } from "../../../src/TestExplorer/TestRunArguments";
import { flattenTestItemCollection } from "../../../src/TestExplorer/TestUtils";

suite("TestRunArguments Suite", () => {
    // Helper function to create a test item tree from a DSL string.
    // Tabs are used to denote a hierarchy of test items.
    function createTestItemTree(controller: vscode.TestController, dsl: string) {
        const lines = dsl.trim().split("\n");
        const stack: { item: vscode.TestItem; indent: number }[] = [];
        let root: vscode.TestItem | undefined;

        lines.forEach(line => {
            const indent = line.search(/\S/);
            const trimmedLine = line.trim();
            const name = trimmedLine.replace(/^(tt:|xc:|st:)/, "");
            const tags = [];
            if (trimmedLine.startsWith("tt:")) {
                tags.push({ id: "test-target" });
            } else if (trimmedLine.startsWith("xc:")) {
                tags.push({ id: "XCTest" });
            } else if (trimmedLine.startsWith("st:")) {
                tags.push({ id: "swift-testing" });
            }
            const item = controller.createTestItem(name, name, vscode.Uri.file("/path/to/file"));
            item.tags = tags;

            while (stack.length && stack[stack.length - 1].indent >= indent) {
                stack.pop();
            }

            if (stack.length) {
                stack[stack.length - 1].item.children.add(item);
            } else {
                root = item;
            }

            stack.push({ item, indent });
        });

        controller.items.add(root!);
    }

    function runRequestByIds(include: string[], exclude: string[] = []) {
        const allTests = flattenTestItemCollection(controller.items);
        const includeItems = include.map(id => allTests.find(item => item.id === id));
        const excludeItems = exclude.map(id => allTests.find(item => item.id === id));
        if (includeItems.some(item => !item)) {
            throw new Error("Could not find test item in include list: " + include);
        }
        if (excludeItems.some(item => !item)) {
            throw new Error("Could not find test item in exclude list: " + include);
        }
        return new vscode.TestRunRequest(
            includeItems as vscode.TestItem[],
            excludeItems as vscode.TestItem[],
            undefined
        );
    }

    function assertRunArguments(
        args: TestRunArguments,
        expected: Omit<
            Omit<Omit<TestRunArguments, "testItems">, "hasXCTests">,
            "hasSwiftTestingTests"
        > & { testItems: string[] }
    ) {
        // Order of testItems doesn't matter, that they contain the same elements.
        assert.deepStrictEqual(
            { ...args, testItems: args.testItems.map(item => item.id).sort() },
            { ...expected, testItems: expected.testItems.sort() }
        );
    }

    let controller: vscode.TestController;
    const testTargetId: string = "TestTarget";
    const xcSuiteId: string = "XCTest Suite";
    const xcTestId: string = "XCTest Item";
    const swiftTestSuiteId: string = "Swift Test Suite";
    const swiftTestId: string = "Swift Test Item";

    beforeEach(function () {
        controller = vscode.tests.createTestController(
            this.currentTest?.id ?? "TestRunArgumentsTests",
            ""
        );
    });

    afterEach(() => {
        controller.dispose();
    });

    suite("Basic Tests", () => {
        beforeEach(() => {
            const dsl = `
                tt:${testTargetId}
                    xc:${xcSuiteId}
                        xc:${xcTestId}
                    st:${swiftTestSuiteId}
                        st:${swiftTestId}
            `;

            createTestItemTree(controller, dsl);
        });

        test("Empty Request", () => {
            const testArgs = new TestRunArguments(runRequestByIds([]), false);
            assertRunArguments(testArgs, {
                xcTestArgs: [],
                swiftTestArgs: [],
                testItems: [],
            });
        });

        test("Test hasTestType methods", () => {
            const xcTest = new TestRunArguments(runRequestByIds([xcTestId]), false);
            const swiftTestingTest = new TestRunArguments(runRequestByIds([swiftTestId]), false);
            const bothTests = new TestRunArguments(runRequestByIds([xcTestId, swiftTestId]), false);
            assert.strictEqual(xcTest.hasXCTests, true);
            assert.strictEqual(xcTest.hasSwiftTestingTests, false);
            assert.strictEqual(swiftTestingTest.hasXCTests, false);
            assert.strictEqual(swiftTestingTest.hasSwiftTestingTests, true);
            assert.strictEqual(bothTests.hasXCTests, true);
            assert.strictEqual(bothTests.hasSwiftTestingTests, true);
        });

        test("Single XCTest", () => {
            const testArgs = new TestRunArguments(runRequestByIds([xcTestId]), false);
            assertRunArguments(testArgs, {
                xcTestArgs: [`${xcTestId}$`],
                swiftTestArgs: [],
                testItems: [xcSuiteId, testTargetId, xcTestId],
            });
        });

        test("Single XCTest (debug mode)", () => {
            const testArgs = new TestRunArguments(runRequestByIds([xcTestId]), true);
            assertRunArguments(testArgs, {
                xcTestArgs: [xcTestId],
                swiftTestArgs: [],
                testItems: [xcSuiteId, testTargetId, xcTestId],
            });
        });

        test("Both Suites Included", () => {
            const testArgs = new TestRunArguments(
                runRequestByIds([xcSuiteId, swiftTestSuiteId]),
                false
            );
            assertRunArguments(testArgs, {
                xcTestArgs: [`${xcSuiteId}/`],
                swiftTestArgs: [`${swiftTestSuiteId}/`],
                testItems: [testTargetId, xcSuiteId, xcTestId, swiftTestSuiteId, swiftTestId],
            });
        });

        test("Exclude Suite", () => {
            const testArgs = new TestRunArguments(
                runRequestByIds([xcSuiteId, swiftTestSuiteId], [xcSuiteId]),
                false
            );
            assertRunArguments(testArgs, {
                xcTestArgs: [],
                swiftTestArgs: [`${swiftTestSuiteId}/`],
                testItems: [testTargetId, swiftTestSuiteId, swiftTestId],
            });
        });

        test("Exclude Test", () => {
            const testArgs = new TestRunArguments(
                runRequestByIds([xcSuiteId, swiftTestSuiteId], [xcTestId]),
                false
            );
            assertRunArguments(testArgs, {
                xcTestArgs: [],
                swiftTestArgs: [`${swiftTestSuiteId}/`],
                testItems: [testTargetId, swiftTestSuiteId, swiftTestId],
            });
        });

        test("Entire test target", () => {
            const testArgs = new TestRunArguments(runRequestByIds([testTargetId], []), false);
            assertRunArguments(testArgs, {
                xcTestArgs: [`${testTargetId}.*`],
                swiftTestArgs: [`${testTargetId}.*`],
                testItems: [testTargetId, xcSuiteId, xcTestId, swiftTestSuiteId, swiftTestId],
            });
        });
    });

    test("Test empty test target", () => {
        createTestItemTree(controller, `tt:${testTargetId}`);
        const testArgs = new TestRunArguments(runRequestByIds([testTargetId], []), false);
        assertRunArguments(testArgs, {
            xcTestArgs: [],
            swiftTestArgs: [],
            testItems: [],
        });
    });

    test("Test undefined include/exclude", () => {
        createTestItemTree(controller, `tt:${testTargetId}`);
        const testArgs = new TestRunArguments(new vscode.TestRunRequest(), false);
        assertRunArguments(testArgs, {
            xcTestArgs: [],
            swiftTestArgs: [],
            testItems: [],
        });
    });

    test("Single Test in Suite With Multiple", () => {
        const anotherSwiftTestId = "Another Swift Test Item";
        const dsl = `
        tt:${testTargetId}
            xc:${xcSuiteId}
                xc:${xcTestId}
            st:${swiftTestSuiteId}
                st:${swiftTestId}
                st:${anotherSwiftTestId}
        `;

        createTestItemTree(controller, dsl);

        const testArgs = new TestRunArguments(runRequestByIds([anotherSwiftTestId]), false);
        assertRunArguments(testArgs, {
            xcTestArgs: [],
            swiftTestArgs: [`${anotherSwiftTestId}/`],
            testItems: [swiftTestSuiteId, testTargetId, anotherSwiftTestId],
        });
    });

    test("Test suite with multiple suites of different sizes", () => {
        const anotherXcSuiteId = "Another XCTest Suite";
        const anotherXcTestId1 = "Another XCTest Item 1";
        const anotherXcTestId2 = "Another XCTest Item 2";
        const dsl = `
        tt:${testTargetId}
            xc:${xcSuiteId}
                xc:${xcTestId}
            xc:${anotherXcSuiteId}
                xc:${anotherXcTestId1}
                xc:${anotherXcTestId2}
        `;
        createTestItemTree(controller, dsl);

        const testArgs = new TestRunArguments(runRequestByIds([xcSuiteId], []), false);
        assertRunArguments(testArgs, {
            xcTestArgs: [`${xcSuiteId}/`],
            swiftTestArgs: [],
            testItems: [testTargetId, xcSuiteId, xcTestId],
        });
    });

    test("Test suite with multiple suites of the same size", () => {
        const xcTestId2 = "XCTest Item 2";
        const anotherXcSuiteId = "Another XCTest Suite";
        const anotherXcTestId1 = "Another XCTest Item 1";
        const anotherXcTestId2 = "Another XCTest Item 2";
        const dsl = `
        tt:${testTargetId}
            xc:${xcSuiteId}
                xc:${xcTestId}
                xc:${xcTestId2}
            xc:${anotherXcSuiteId}
                xc:${anotherXcTestId1}
                xc:${anotherXcTestId2}
        `;
        createTestItemTree(controller, dsl);

        const testArgs = new TestRunArguments(runRequestByIds([xcSuiteId], []), false);
        assertRunArguments(testArgs, {
            xcTestArgs: [`${xcSuiteId}/`],
            swiftTestArgs: [],
            testItems: [testTargetId, xcSuiteId, xcTestId, xcTestId2],
        });
    });

    test("Test multiple tests across suites", () => {
        const xcTestId2 = "XCTest Item 2";
        const anotherXcSuiteId = "Another XCTest Suite";
        const anotherXcTestId1 = "Another XCTest Item 1";
        const anotherXcTestId2 = "Another XCTest Item 2";
        const dsl = `
        tt:${testTargetId}
            xc:${xcSuiteId}
                xc:${xcTestId}
                xc:${xcTestId2}
            xc:${anotherXcSuiteId}
                xc:${anotherXcTestId1}
                xc:${anotherXcTestId2}
        `;
        createTestItemTree(controller, dsl);

        const testArgs = new TestRunArguments(
            runRequestByIds([xcTestId, anotherXcTestId1], []),
            false
        );
        assertRunArguments(testArgs, {
            xcTestArgs: [`${xcTestId}$`, `${anotherXcTestId1}$`],
            swiftTestArgs: [],
            testItems: [testTargetId, xcSuiteId, xcTestId, anotherXcSuiteId, anotherXcTestId1],
        });
    });

    test("Full XCTest Target (debug mode)", () => {
        const xcTestId2 = "XCTest Item 2";
        const anotherXcSuiteId = "Another XCTest Suite";
        const anotherXcTestId1 = "Another XCTest Item 1";
        const anotherXcTestId2 = "Another XCTest Item 2";
        const dsl = `
        tt:${testTargetId}
            xc:${xcSuiteId}
                xc:${xcTestId}
                xc:${xcTestId2}
            xc:${anotherXcSuiteId}
                xc:${anotherXcTestId1}
                xc:${anotherXcTestId2}
        `;
        createTestItemTree(controller, dsl);
        const testArgs = new TestRunArguments(runRequestByIds([testTargetId]), true);
        assertRunArguments(testArgs, {
            xcTestArgs: [xcSuiteId, anotherXcSuiteId],
            swiftTestArgs: [],
            testItems: [
                anotherXcTestId1,
                anotherXcTestId2,
                anotherXcSuiteId,
                xcSuiteId,
                testTargetId,
                xcTestId2,
                xcTestId,
            ],
        });
    });
});
