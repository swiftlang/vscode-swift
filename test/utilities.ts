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
import { SwiftTaskFixture } from "./fixtures";
import { SwiftTask } from "../src/tasks/SwiftTaskProvider";

/**
 * Executes a {@link SwiftTask}, accumulates output, and
 * waits for the exit code
 *
 * @param fixture {@link SwiftTaskFixture} or {@link SwiftTask}
 * @returns Object with `exitCode` and accumulated `output`. If no `exitCode`, task terminated abruptly
 */
export async function executeTaskAndWaitForResult(
    fixture: SwiftTaskFixture | SwiftTask
): Promise<{ exitCode?: number; output: string }> {
    const task = (fixture instanceof vscode.Task ? fixture : fixture.task) as SwiftTask;
    let output = "";
    const disposables = [task.execution.onDidWrite(e => (output += e))];
    const promise = new Promise<number | undefined>(res =>
        disposables.push(
            task.execution.onDidClose(e => {
                disposables.forEach(d => d.dispose());
                res(typeof e === "number" ? e : undefined);
            })
        )
    );
    await vscode.tasks.executeTask(task);
    const exitCode = await promise;
    return {
        output,
        exitCode,
    };
}

/**
 * Wait for the writeable fixture to write some output
 *
 * @param fixture {@link SwiftTaskFixture} or {@link SwiftTask}
 * @returns The string that was written
 */
export async function waitForWrite(fixture: { onDidWrite: vscode.Event<string> }): Promise<string> {
    return new Promise<string>(res => {
        const disposable = fixture.onDidWrite(e => {
            disposable.dispose();
            res(e);
        });
    });
}

/**
 * Wait for the writeable fixture to write some output
 *
 * @param fixture {@link SwiftTaskFixture} or {@link SwiftTask}
 * @returns The string that was written
 */
export async function waitForClose(fixture: {
    onDidClose: vscode.Event<number | void>;
}): Promise<number | undefined> {
    return new Promise<number | undefined>(res => {
        const disposable = fixture.onDidClose(e => {
            disposable.dispose();
            res(typeof e === "number" ? e : undefined);
        });
    });
}

/**
 * So spuratic failures can happen if a task that closely
 * matches an old one is spawned to close together, so this
 * utility can be used to make sure no task is running
 * before starting a new test
 */
export async function waitForNoRunningTasks(): Promise<void> {
    await new Promise<void>(res => {
        if (vscode.tasks.taskExecutions.length === 0) {
            res();
            return;
        }
        const disposable = vscode.tasks.onDidEndTask(() => {
            if (vscode.tasks.taskExecutions.length > 0) {
                return;
            }
            disposable?.dispose();
            res();
        });
    });
}
