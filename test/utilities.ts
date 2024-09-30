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

export type Mutable<T> = {
    -readonly [K in keyof T]: T[K];
};

export function mutable<T>(target: T): Mutable<T> {
    return target;
}

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
    const task = ("task" in fixture ? fixture.task : fixture) as SwiftTask;
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
export function waitForNoRunningTasks(): Promise<void> {
    return new Promise<void>(res => {
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

/**
 * Ideally we would want to use {@link executeTaskAndWaitForResult} but that
 * requires the tests creating the task through some means. If the
 * {@link vscode.Task Task}, was provided by the extension under test, the
 * {@link SwiftTask.execution} event emitters never seem to fire.
 *
 * @param task task to listen for close event
 * @returns exitCode for task execution, undefined if terminated unexpectedly
 */
export function waitForEndTaskProcess(task: vscode.Task): Promise<number | undefined> {
    return new Promise<number | undefined>(res => {
        const disposables: vscode.Disposable[] = [];
        disposables.push(
            vscode.tasks.onDidEndTaskProcess(e => {
                if (task.detail !== e.execution.task.detail) {
                    return;
                }
                disposables.forEach(d => d.dispose());
                res(e.exitCode);
            })
        );
    });
}
