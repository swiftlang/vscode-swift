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
import { TestRunner, TestRunnerTestRunState } from "../TestExplorer/TestRunner";
import { WorkspaceContext } from "../WorkspaceContext";

/**
 * Runs the supplied TestItem a number of times. The user is prompted with a dialog
 * to pick how many times they want the test to run.
 * @param ctx The workspace context, used to get the Test Explorer
 * @param test The test to run multiple times
 * @param untilFailure If `true` stop running the test if it fails
 */
export async function runTestMultipleTimes(
    ctx: WorkspaceContext,
    test: vscode.TestItem,
    untilFailure: boolean
) {
    const str = await vscode.window.showInputBox({
        prompt: "Label: ",
        placeHolder: `${untilFailure ? "Maximum " : ""}# of times to run`,
        validateInput: value => (/^[1-9]\d*$/.test(value) ? undefined : "Enter an integer value"),
    });

    if (!str || !ctx.currentFolder?.testExplorer) {
        return;
    }

    const numExecutions = parseInt(str);
    const testExplorer = ctx.currentFolder.testExplorer;
    const runner = new TestRunner(
        TestKind.standard,
        new vscode.TestRunRequest([test]),
        ctx.currentFolder,
        testExplorer.controller
    );

    testExplorer.onDidCreateTestRunEmitter.fire(runner.testRun);

    const testRunState = new TestRunnerTestRunState(runner.testRun);
    const token = new vscode.CancellationTokenSource();

    vscode.commands.executeCommand("workbench.panel.testResults.view.focus");

    for (let i = 0; i < numExecutions; i++) {
        runner.setIteration(i);
        runner.testRun.appendOutput(`\x1b[36mBeginning Test Iteration #${i + 1}\x1b[0m\n`);

        await runner.runSession(token.token, testRunState);

        if (
            untilFailure &&
            (runner.testRun.runState.failed.length > 0 ||
                runner.testRun.runState.errored.length > 0)
        ) {
            break;
        }
    }
    runner.testRun.end();
}
