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
import { isDebugging, TestKind } from "../TestExplorer/TestKind";
import { TestRunner, TestRunnerTestRunState, TestRunState } from "../TestExplorer/TestRunner";
import { FolderContext } from "../FolderContext";
import { colorize } from "../utilities/utilities";

/**
 * Runs the supplied TestItem a number of times. The user is prompted with a dialog
 * to pick how many times they want the test to run.
 * @param ctx The workspace context, used to get the Test Explorer
 * @param test The test to run multiple times
 * @param untilFailure If `true` stop running the test if it fails
 */
export async function runTestMultipleTimes(
    currentFolder: FolderContext,
    tests: vscode.TestItem[],
    untilFailure: boolean,
    kind: TestKind,
    count: number | undefined = undefined,
    testRunner?: () => Promise<TestRunState>
) {
    let numExecutions = count;
    if (numExecutions === undefined) {
        const str = await vscode.window.showInputBox({
            placeHolder: `${untilFailure ? "Maximum " : ""}# of times to run`,
            validateInput: value =>
                /^[1-9]\d*$/.test(value) ? undefined : "Enter an integer value",
        });
        if (!str) {
            return;
        }
        numExecutions = parseInt(str);
    }

    if (!currentFolder.testExplorer) {
        return;
    }
    const token = new vscode.CancellationTokenSource();
    const testExplorer = currentFolder.testExplorer;
    const request = new vscode.TestRunRequest(tests);
    const runner = new TestRunner(
        kind,
        request,
        currentFolder,
        testExplorer.controller,
        token.token
    );

    // If the user terminates a debugging session we want
    // to cancel the remaining iterations.
    const terminationListener = runner.onDebugSessionTerminated(() => token.cancel());

    testExplorer.onDidCreateTestRunEmitter.fire(runner.testRun);

    const testRunState = new TestRunnerTestRunState(runner.testRun);

    await vscode.commands.executeCommand("workbench.panel.testResults.view.focus");

    const runStates: TestRunState[] = [];
    for (let i = 0; i < numExecutions; i++) {
        runner.setIteration(i);
        runner.testRun.appendOutput(
            colorize(`Beginning Test Iteration #${i + 1}`, "cyan") + "\n\r"
        );

        let runState: TestRunState;
        if (testRunner !== undefined) {
            runState = await testRunner();
        } else if (isDebugging(kind)) {
            runState = await runner.debugSession(testRunState, i === 0);
        } else {
            runState = await runner.runSession(testRunState);
        }

        runStates.push(runState);

        if (
            runner.testRun.isCancellationRequested ||
            (untilFailure && (runState.failed.length > 0 || runState.errored.length > 0))
        ) {
            break;
        }
    }
    await runner.testRun.end();
    terminationListener.dispose();

    return runStates;
}

/**
 * Extracts an array of vscode.TestItem and count from the provided varargs. Effectively, this
 * converts a varargs function from accepting both numbers and test items to:
 *
 *     function (...testItems: vscode.TestItem[], count?: number): void;
 *
 * The VS Code testing view sends test items via varargs, but we have a couple testing commands that
 * also accept a final count parameter. We have to find the count parameter ourselves since JavaScript
 * only supports varargs at the end of an argument list.
 */
export function extractTestItemsAndCount(
    ...args: (vscode.TestItem | number | undefined | null)[]
): {
    testItems: vscode.TestItem[];
    count?: number;
} {
    const result = args.reduce<{
        testItems: vscode.TestItem[];
        count?: number;
    }>(
        (result, arg, index) => {
            if (arg === undefined || arg === null) {
                return result;
            } else if (typeof arg === "number" && index === args.length - 1) {
                result.count = arg ?? undefined;
                return result;
            } else if (typeof arg === "object") {
                if (arg.hasOwnProperty("id") && arg.hasOwnProperty("uri")) {
                    result.testItems.push(arg);
                }
                return result;
            } else {
                throw new Error(`Unexpected argument ${arg} at index ${index}`);
            }
        },
        { testItems: [] }
    );
    return result;
}
