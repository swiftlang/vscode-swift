//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as vscode from "vscode";

import { TestRunProxy } from "./TestRunProxy";
import { reduceTestItemChildren } from "./TestUtils";

type ProcessResult = {
    testItems: vscode.TestItem[];
    xcTestArgs: vscode.TestItem[];
    swiftTestArgs: vscode.TestItem[];
};

/**
 * Given a `TestRunRequest`, produces the lists of
 * XCTests and swift-testing tests to run.
 */
export class TestRunArguments {
    public testItems: vscode.TestItem[];
    public xcTestArgs: string[];
    public swiftTestArgs: string[];

    constructor(request: vscode.TestRunRequest, isDebug: boolean) {
        const { testItems, xcTestArgs, swiftTestArgs } = this.createTestLists(request, isDebug);
        this.testItems = testItems;
        this.xcTestArgs = this.annotateTestArgs(xcTestArgs, isDebug);
        this.swiftTestArgs = this.annotateTestArgs(swiftTestArgs, isDebug);
    }

    /**
     * Returns true if there are XCTests specified in the request.
     */
    public get hasXCTests(): boolean {
        return this.xcTestArgs.length > 0 || this.hasNoSpecifiedTests;
    }

    /**
     * Returns true if there are swift-testing tests specified in the request.
     */
    public get hasSwiftTestingTests(): boolean {
        return this.swiftTestArgs.length > 0 || this.hasNoSpecifiedTests;
    }

    /**
     * Returns true if there are no tests specified in the request,
     * which indicates that we should run all tests.
     */
    private get hasNoSpecifiedTests(): boolean {
        return this.testItems.length === 0;
    }

    /**
     * Construct test item list from TestRequest
     * @returns list of test items to run and list of test for XCTest arguments
     */
    private createTestLists(request: vscode.TestRunRequest, isDebug: boolean): ProcessResult {
        const includes = request.include ?? [];
        const excludes = request.exclude ?? [];
        return includes.reduce(this.createTestItemReducer(includes, excludes, isDebug), {
            testItems: this.createIncludeParentList(includes),
            xcTestArgs: [],
            swiftTestArgs: [],
        });
    }

    /**
     * For all the included tests we want to collect up a list of their
     * parents so they are included in the final testItems list. Otherwise
     * we'll get testStart/End events for testItems we have no record of.
     */
    private createIncludeParentList(includes: readonly vscode.TestItem[]): vscode.TestItem[] {
        const parents = includes.reduce((map, include) => {
            let parent = include.parent;
            while (parent) {
                map.set(parent.id, parent);
                parent = parent.parent;
            }
            return map;
        }, new Map<string, vscode.TestItem>());
        return Array.from(parents.values());
    }

    /**
     * Converts a list of TestItems to a regex test item ID. Depending on the TestItem's
     * tags and whether it is a debug run the ID is converted to a regex pattern that will
     * match the correct tests when passed to the `--filter` argument of `swift test`.
     */
    private annotateTestArgs(testArgs: vscode.TestItem[], isDebug: boolean): string[] {
        return testArgs.map(arg => {
            const isTestTarget = !!arg.tags.find(tag => tag.id === "test-target");
            if (isTestTarget) {
                return `${arg.id}.*`;
            }
            const isXCTest = !!arg.tags.find(tag => tag.id === "XCTest");
            const hasChildren = arg.children.size > 0;
            if (isXCTest) {
                const terminator = hasChildren ? "/" : "$";
                // Debugging XCTests requires exact matches, so we don't need a trailing terminator.
                return isDebug ? arg.id : `${arg.id}${terminator}`;
            } else if (hasChildren && !this.hasParameterizedTestChildren(arg)) {
                // Append a trailing slash to match a suite name exactly.
                // This prevents TestTarget.MySuite matching TestTarget.MySuite2.
                return `${arg.id}/`;
            }
            return arg.id;
        });
    }

    private hasParameterizedTestChildren(testItem: vscode.TestItem): boolean {
        return Array.from(testItem.children).some(arr =>
            arr[1].tags.some(tag => tag.id === TestRunProxy.Tags.PARAMETERIZED_TEST_RESULT)
        );
    }

    private createTestItemReducer(
        include: readonly vscode.TestItem[],
        exclude: readonly vscode.TestItem[],
        isDebug: boolean
    ): (previousValue: ProcessResult, testItem: vscode.TestItem) => ProcessResult {
        return (previousValue, testItem) => {
            const { testItems, swiftTestArgs, xcTestArgs } = this.processTestItem(
                testItem,
                include,
                exclude,
                isDebug
            );

            // If no children were added we can skip adding this parent.
            if (xcTestArgs.length + swiftTestArgs.length === 0) {
                return previousValue;
            } else if (this.itemContainsAllArgs(testItem, xcTestArgs, swiftTestArgs)) {
                // If we're including every chlid in the parent, we can simplify the
                // arguments and just use the parent
                const { xcTestResult, swiftTestResult } = this.simplifyTestArgs(
                    testItem,
                    xcTestArgs,
                    swiftTestArgs,
                    isDebug
                );

                return {
                    testItems: [...previousValue.testItems, ...testItems],
                    xcTestArgs: [...previousValue.xcTestArgs, ...xcTestResult],
                    swiftTestArgs: [...previousValue.swiftTestArgs, ...swiftTestResult],
                };
            } else {
                // If we've only added some of the children the append to our test list
                return {
                    testItems: [...previousValue.testItems, ...testItems],
                    swiftTestArgs: [...previousValue.swiftTestArgs, ...swiftTestArgs],
                    xcTestArgs: [...previousValue.xcTestArgs, ...xcTestArgs],
                };
            }
        };
    }

    private itemContainsAllArgs(
        testItem: vscode.TestItem,
        xcTestArgs: vscode.TestItem[],
        swiftTestArgs: vscode.TestItem[]
    ): boolean {
        return (
            testItem.children.size > 0 &&
            xcTestArgs.length + swiftTestArgs.length === testItem.children.size
        );
    }

    private simplifyTestArgs(
        testItem: vscode.TestItem,
        xcTestArgs: vscode.TestItem[],
        swiftTestArgs: vscode.TestItem[],
        isDebug: boolean
    ): { xcTestResult: vscode.TestItem[]; swiftTestResult: vscode.TestItem[] } {
        // If we've worked all the way up to a test target, it may have both swift-testing
        // and XCTests.
        const isTestTarget = !!testItem.tags.find(tag => tag.id === "test-target");

        if (isTestTarget) {
            // We cannot simplify away test suites leaving only the target if we are debugging,
            // since the exact names of test suites to run need to be passed to the xctest binary.
            // It will not debug all tests with only the target name.
            if (isDebug) {
                return {
                    xcTestResult: xcTestArgs,
                    swiftTestResult: swiftTestArgs,
                };
            }
            return {
                // Add a trailing .* to match a test target name exactly.
                // This prevents TestTarget matching TestTarget2.
                xcTestResult: xcTestArgs.length > 0 ? [testItem] : [],
                swiftTestResult: swiftTestArgs.length > 0 ? [testItem] : [],
            };
        }

        // If we've added all the children to the list of arguments, just add
        // the parent instead of each individual child. This crafts a minimal set
        // of test/suites that run all the test cases requested with the smallest list
        // of arguments. The testItem has to have a parent to perform this optimization.
        // If it does not we break the ability to run both swift testing tests and XCTests
        // in the same run, since test targets can have both types of tests in them.
        const isXCTest = !!testItem.tags.find(tag => tag.id === "XCTest");
        return {
            xcTestResult: isXCTest ? [testItem] : [],
            swiftTestResult: !isXCTest ? [testItem] : [],
        };
    }

    private processTestItem(
        testItem: vscode.TestItem,
        include: readonly vscode.TestItem[],
        exclude: readonly vscode.TestItem[],
        isDebug: boolean
    ): ProcessResult {
        // Skip tests the user asked to exclude
        if (exclude.includes(testItem)) {
            return {
                testItems: [],
                xcTestArgs: [],
                swiftTestArgs: [],
            };
        }

        const testItems: vscode.TestItem[] = [];
        const xcTestArgs: vscode.TestItem[] = [];
        const swiftTestArgs: vscode.TestItem[] = [];

        // If this test item is included or we are including everything
        if (include.includes(testItem) || include.length === 0) {
            const isXCTest = testItem.tags.find(tag => tag.id === "XCTest");
            const isSwiftTestingTest = testItem.tags.find(tag => tag.id === "swift-testing");

            // Collect up a list of all the test items involved in the run
            // from the TestExplorer tree and store them in `testItems`. Exclude
            // parameterized test result entries from this list (they don't have a uri).
            if (testItem.uri !== undefined || isXCTest) {
                testItems.push(testItem);

                // Only add leaf items to the list of arguments to pass to the test runner.
                if (this.isLeafTestItem(testItem, !!isXCTest)) {
                    if (isXCTest) {
                        xcTestArgs.push(testItem);
                    } else if (isSwiftTestingTest) {
                        swiftTestArgs.push(testItem);
                    }
                }
            }
        }

        return reduceTestItemChildren(
            testItem.children,
            this.createTestItemReducer([], exclude, isDebug),
            {
                testItems,
                xcTestArgs,
                swiftTestArgs,
            }
        );
    }

    private isLeafTestItem(testItem: vscode.TestItem, isXCTest: boolean) {
        if (isXCTest) {
            return testItem.children.size === 0;
        }

        let result = true;
        testItem.children.forEach(child => {
            if (child.uri) {
                result = false;
            }
        });
        return result;
    }
}
