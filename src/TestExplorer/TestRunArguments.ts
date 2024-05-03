//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { reduceTestItemChildren } from "./TestUtils";

type ProcessResult = {
    testItems: vscode.TestItem[];
    xcTestArgs: string[];
    swiftTestArgs: string[];
};

/**
 * Given a `TestRunRequest`, produces the lists of
 * XCTests and swift-testing tests to run.
 */
export class TestRunArguments {
    public testItems: vscode.TestItem[];
    public xcTestArgs: string[];
    public swiftTestArgs: string[];

    constructor(request: vscode.TestRunRequest) {
        const { testItems, xcTestArgs, swiftTestArgs } = this.createTestLists(request);
        this.testItems = testItems;
        this.xcTestArgs = xcTestArgs;
        this.swiftTestArgs = swiftTestArgs;
    }

    public get hasXCTests(): boolean {
        return this.xcTestArgs.length > 0;
    }

    public get hasSwiftTestingTests(): boolean {
        return this.swiftTestArgs.length > 0;
    }

    /**
     * Construct test item list from TestRequest
     * @returns list of test items to run and list of test for XCTest arguments
     */
    private createTestLists(request: vscode.TestRunRequest): ProcessResult {
        const includes = request.include ?? [];
        return includes.reduce(this.createTestItemReducer(request.include, request.exclude), {
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

    private createTestItemReducer(
        include: readonly vscode.TestItem[] | undefined,
        exclude: readonly vscode.TestItem[] | undefined
    ): (previousValue: ProcessResult, testItem: vscode.TestItem) => ProcessResult {
        return (previousValue, testItem) => {
            const { testItems, swiftTestArgs, xcTestArgs } = this.processTestItem(
                testItem,
                include,
                exclude
            );

            // If no children were added we can skip adding this parent.
            if (xcTestArgs.length + swiftTestArgs.length === 0) {
                return previousValue;
            } else if (
                xcTestArgs.length + swiftTestArgs.length === testItem.children.size &&
                testItem.parent
            ) {
                // If we've added all the children to the list of arguments, just add
                // the parent instead of each individual child. This crafts a minimal set
                // of test/suites that run all the test cases requested with the smallest list
                // of arguments. The testItem has to have a parent to perform this optimization.
                // If it does not we break the ability to run both swift testing tests and XCTests
                // in the same run, since test targets can have both types of tests in them.
                const isXCTest = !!testItem.tags.find(tag => tag.id === "XCTest");
                return {
                    testItems: [...previousValue.testItems, ...testItems],
                    swiftTestArgs: [
                        ...previousValue.swiftTestArgs,
                        ...(!isXCTest ? [testItem.id] : []),
                    ],
                    xcTestArgs: [...previousValue.xcTestArgs, ...(isXCTest ? [testItem.id] : [])],
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

    private processTestItem(
        testItem: vscode.TestItem,
        include?: readonly vscode.TestItem[],
        exclude?: readonly vscode.TestItem[]
    ): ProcessResult {
        // Skip tests the user asked to exclude
        if (exclude?.includes(testItem)) {
            return {
                testItems: [],
                xcTestArgs: [],
                swiftTestArgs: [],
            };
        }

        const testItems: vscode.TestItem[] = [];
        const xcTestArgs: string[] = [];
        const swiftTestArgs: string[] = [];

        // If this test item is included or we are including everything
        if (include?.includes(testItem) || !include) {
            // Collect up a list of all the test items involved in the run
            // from the TestExplorer tree and store them in `testItems`. Exclude
            // parameterized test result entries from this list (they don't have a uri).
            if (testItem.uri !== undefined) {
                testItems.push(testItem);

                // Only add leaf items to the list of arguments to pass to the test runner.
                if (this.isLeafTestItem(testItem)) {
                    if (testItem.tags.find(tag => tag.id === "XCTest")) {
                        xcTestArgs.push(testItem.id);
                    } else {
                        swiftTestArgs.push(testItem.id);
                    }
                }
            }
        }

        return reduceTestItemChildren(
            testItem.children,
            this.createTestItemReducer(undefined, exclude),
            {
                testItems,
                xcTestArgs,
                swiftTestArgs,
            }
        );
    }

    private isLeafTestItem(testItem: vscode.TestItem) {
        let result = true;
        testItem.children.forEach(child => {
            if (child.uri) {
                result = false;
            }
        });
        return result;
    }
}
