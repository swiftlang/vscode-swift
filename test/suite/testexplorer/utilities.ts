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
import { reduceTestItemChildren } from "../../../src/TestExplorer/TestUtils";
import { TestRunProxy } from "../../../src/TestExplorer/TestRunner";

/**
 * Given a path in the form TestTarget.Suite.test, reutrns the test item from the TestController
 */
export function getTestItem(
    controller: vscode.TestController,
    itemId: string
): vscode.TestItem | undefined {
    function searchChildren(items: vscode.TestItemCollection): vscode.TestItem | undefined {
        return reduceTestItemChildren(
            items,
            (acc, item) => {
                if (acc) {
                    return acc;
                } else if (item.id === itemId) {
                    return item;
                }

                return searchChildren(item.children);
            },
            undefined as vscode.TestItem | undefined
        );
    }

    return searchChildren(controller.items);
}

type TestHierarchy = string | TestHierarchy[];

/**
 * Asserts that the test item hierarchy matches the description provided by a collection
 * of `TestControllerState`s.
 */
export function assertTestControllerHierarchy(
    controller: vscode.TestController,
    state: TestHierarchy
) {
    const buildStateFromController = (items: vscode.TestItemCollection): TestHierarchy =>
        reduceTestItemChildren(
            items,
            (acc, item) => {
                const children = buildStateFromController(item.children);
                return [...acc, item.label, ...(children.length ? [children] : [])];
            },
            [] as TestHierarchy
        );

    assert.deepEqual(
        buildStateFromController(controller.items),
        state,
        "Expected TextExplorer to have a different state"
    );
}

/**
 * Asserts on the result of a test run.
 *
 * The order of tests is not verified because swift-testing
 * tests run in parallel and can complete in any order.
 */
export function assertTestResults(
    testRun: TestRunProxy,
    state: {
        failed?: {
            test: string;
            issues: string[];
        }[];
        passed?: string[];
        skipped?: string[];
        errored?: string[];
        unknown?: number;
    }
) {
    assert.deepEqual(
        {
            passed: testRun.runState.passed.map(({ id }) => id).sort(),
            failed: testRun.runState.failed
                .map(({ test, message }) => ({
                    test: test.id,
                    issues: Array.isArray(message)
                        ? message.map(({ message }) => message)
                        : [(message as vscode.TestMessage).message],
                }))
                .sort(),
            skipped: testRun.runState.skipped.map(({ id }) => id).sort(),
            errored: testRun.runState.errored.map(({ id }) => id).sort(),
            unknown: testRun.runState.unknown,
        },
        {
            passed: (state.passed ?? []).sort(),
            failed: (state.failed ?? []).sort(),
            skipped: (state.skipped ?? []).sort(),
            errored: (state.errored ?? []).sort(),
            unknown: 0,
        }
    );
}

export function syncPromise(callback: () => void): Promise<void> {
    return new Promise(resolve => {
        callback();
        resolve();
    });
}

export function eventPromise<T>(event: vscode.Event<T>): Promise<T> {
    return new Promise(resolve => {
        event(t => resolve(t));
    });
}
