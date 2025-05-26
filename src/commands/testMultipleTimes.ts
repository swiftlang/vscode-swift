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
import { TestKind } from "../TestExplorer/TestKind";
import { TestRunner, TestRunnerTestRunState, TestRunState } from "../TestExplorer/TestRunner";
import { FolderContext } from "../FolderContext";

/**
 * Runs the supplied TestItem a number of times. The user is prompted with a dialog
 * to pick how many times they want the test to run.
 * @param ctx The workspace context, used to get the Test Explorer
 * @param test The test to run multiple times
 * @param untilFailure If `true` stop running the test if it fails
 */
export async function runTestMultipleTimes(
    currentFolder: FolderContext,
    test: vscode.TestItem,
    untilFailure: boolean,
    testRunner?: () => Promise<TestRunState>
) {
    console.log("here 3.0");
    const str = await vscode.window.showInputBox({
        prompt: "Label: ",
        placeHolder: `${untilFailure ? "Maximum " : ""}# of times to run`,
        validateInput: value => (/^[1-9]\d*$/.test(value) ? undefined : "Enter an integer value"),
    });
    console.log("here 3.1");

    if (!str || !currentFolder.testExplorer) {
        return;
    }
    console.log("here 3.2");
    const token = new vscode.CancellationTokenSource();
    const numExecutions = parseInt(str);
    const testExplorer = currentFolder.testExplorer;
    const runner = new TestRunner(
        TestKind.standard,
        new vscode.TestRunRequest([test]),
        currentFolder,
        testExplorer.controller,
        token.token
    );

    console.log("here 3.3");
    testExplorer.onDidCreateTestRunEmitter.fire(runner.testRun);

    const testRunState = new TestRunnerTestRunState(runner.testRun);

    await vscode.commands.executeCommand("workbench.panel.testResults.view.focus");
    console.log("here 3.4");

    const runStates: TestRunState[] = [];
    for (let i = 0; i < numExecutions; i++) {
        runner.setIteration(i);
        runner.testRun.appendOutput(`\x1b[36mBeginning Test Iteration #${i + 1}\x1b[0m\n`);

        const runState = await (testRunner !== undefined
            ? testRunner()
            : runner.runSession(testRunState));
        console.log("here 3.5 " + i);

        runStates.push(runState);

        if (untilFailure && (runState.failed.length > 0 || runState.errored.length > 0)) {
            break;
        }
    }
    console.log("here 3.6");
    await runner.testRun.end();
    console.log("here 3.7");

    return runStates;
}
