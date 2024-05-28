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
 */
export function assertTestResults(
    testRun: TestRunProxy,
    state: {
        failed?: string[];
        passed?: string[];
        skipped?: string[];
        errored?: string[];
    }
) {
    assert.deepEqual(
        {
            passed: testRun.runState.passed.map(({ id }) => id),
            failed: testRun.runState.failed.map(({ id }) => id),
            skipped: testRun.runState.skipped.map(({ id }) => id),
            errored: testRun.runState.errored.map(({ id }) => id),
        },
        {
            passed: state.passed ?? [],
            failed: state.failed ?? [],
            skipped: state.skipped ?? [],
            errored: state.errored ?? [],
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
