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
import { TestExplorer } from "../../../src/TestExplorer/TestExplorer";
import { TestKind } from "../../../src/TestExplorer/TestKind";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { testAssetUri } from "../../fixtures";
import {
    activateExtension,
    deactivateExtension,
    SettingsMap,
    updateSettings,
} from "../utilities/testutilities";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import stripAnsi = require("strip-ansi");

/**
 * Sets up a test that leverages the TestExplorer, returning the TestExplorer,
 * WorkspaceContext and a callback to revert the settings back to their original values.
 * @param settings Optional extension settings to set before the test starts.
 * @returns Object containing the TestExplorer, WorkspaceContext and a callback to revert
 * the settings back to their original values.
 */
export async function setupTestExplorerTest(currentTest?: Mocha.Test, settings: SettingsMap = {}) {
    const settingsTeardown = await updateSettings(settings);

    const testProject = testAssetUri("defaultPackage");

    const workspaceContext = await activateExtension(currentTest);
    const testExplorer = testExplorerFor(workspaceContext, testProject);

    // Set up the listener before bringing the text explorer in to focus,
    // which starts searching the workspace for tests.
    await waitForTestExplorerReady(testExplorer);

    return {
        settingsTeardown: async () => {
            await settingsTeardown();
            await deactivateExtension();
        },
        workspaceContext,
        testExplorer,
    };
}

/**
 * Returns the TestExplorer for the given workspace and package folder.
 *
 * @param workspaceContext The workspace to search
 * @param packageFolder The package folder within the workspace
 * @returns The TestExplorer for the package
 */
export function testExplorerFor(
    workspaceContext: WorkspaceContext,
    packageFolder: vscode.Uri
): TestExplorer {
    const targetFolder = workspaceContext.folders.find(
        folder => folder.folder.path === packageFolder.path
    );
    if (!targetFolder || !targetFolder.testExplorer) {
        throw new Error("Unable to find test explorer");
    }
    return targetFolder.testExplorer;
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
 * Asserts that the array contains the value.
 *
 * @param array The array to check.
 * @param value The value to check for.
 */
export function assertContains<T>(array: T[], value: T) {
    assert.ok(array.includes(value), `${value} is not in ${array}`);
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
                        ? message.map(({ message }) => stripAnsi(message.toString()))
                        : [stripAnsi((message as vscode.TestMessage).message.toString())],
                }))
                .sort(),
            skipped: testRun.runState.skipped.map(({ id }) => id).sort(),
            errored: testRun.runState.errored.map(({ id }) => id).sort(),
            unknown: testRun.runState.unknown,
        },
        {
            passed: (state.passed ?? []).sort(),
            failed: (state.failed ?? [])
                .map(({ test, issues }) => ({
                    test,
                    issues: issues.map(message => stripAnsi(message)),
                }))
                .sort(),
            skipped: (state.skipped ?? []).sort(),
            errored: (state.errored ?? []).sort(),
            unknown: 0,
        }
    );
}

function syncPromise(callback: () => void): Promise<void> {
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

/**
 * After extension activation the test explorer needs to be initialized before the controller is ready.
 * Use this method to wait for the test explorer be available for test items
 * to be populated.
 *
 * @param testExplorer The test explorer to wait on
 * @returns The initialized test controller
 */
export async function waitForTestExplorerReady(
    testExplorer: TestExplorer
): Promise<vscode.TestController> {
    return (
        await Promise.all([
            testExplorer.controller.items.size === 0
                ? eventPromise(testExplorer.onTestItemsDidChange)
                : Promise.resolve(testExplorer.controller),
            syncPromise(() => vscode.commands.executeCommand("workbench.view.testing.focus")),
        ])
    )[0];
}

/**
 * Given a path in the form TestTarget.Suite.test, reutrns the test item from the TestController
 */
function getTestItem(
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

/**
 * Returns a list of `vscode.TestItem`s given a list of string test
 * IDs and a `vscode.TestController` to search in.
 *
 * @param controller A `vscode.TestController` to search in
 * @param tests A list of test IDs
 * @returns A collection of resolved `vscode.TestItem`s
 */
export async function gatherTests(
    controller: vscode.TestController,
    ...tests: string[]
): Promise<vscode.TestItem[]> {
    const testItems = tests.map(test => {
        const testItem = getTestItem(controller, test);
        if (!testItem) {
            const testsInController = reduceTestItemChildren(
                controller.items,
                (acc, item) => {
                    acc.push(
                        `${item.id}: ${item.label} ${item.error ? `(error: ${item.error})` : ""}`
                    );
                    return acc;
                },
                [] as string[]
            );

            assert.fail(
                `Unable to find ${test} in Test Controller. Items in test controller are: ${testsInController.join(", ")}`
            );
        }
        assert.ok(testItem);
        return testItem;
    });

    return testItems;
}

/**
 * Executes a test run based on the specified test profile and test items.
 *
 * @param testExplorer A test explorer
 * @param runProfile The TestKind to use when running the tests (Standard, Debug, Coverage, etc...)
 * @param tests A variable number of test IDs or names to be gathered and run.
 * @returns A test run proxy whose `runState` can be inspected for test results.
 */
export async function runTest(
    testExplorer: TestExplorer,
    runProfile: TestKind,
    ...tests: string[]
): Promise<TestRunProxy> {
    const targetProfile = testExplorer.testRunProfiles.find(
        profile => profile.label === runProfile
    );
    if (!targetProfile) {
        throw new Error(`Unable to find run profile named ${runProfile}`);
    }
    const testItems = await gatherTests(testExplorer.controller, ...tests);
    const request = new vscode.TestRunRequest(testItems);

    return (
        await Promise.all([
            eventPromise(testExplorer.onCreateTestRun),
            targetProfile.runHandler(request, new vscode.CancellationTokenSource().token),
        ])
    )[0];
}
