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
// eslint-disable-next-line @typescript-eslint/no-require-imports
import stripAnsi = require("strip-ansi");
import { SwiftTaskFixture } from "../fixtures";
import { SwiftTask } from "../../src/tasks/SwiftTaskProvider";

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
    const task = "task" in fixture ? fixture.task : fixture;
    const endPromise = waitForEndTask(task);
    const promise = new Promise<{ exitCode?: number; output: string }>(res =>
        vscode.tasks.onDidStartTask(async ({ execution }) => {
            const runningTask = execution.task as SwiftTask;
            if (task.detail !== runningTask.detail) {
                return;
            }
            let output = "";
            const disposables = [runningTask.execution.onDidWrite(e => (output += e))];
            const exitPromise = new Promise<number>(res => {
                disposables.push(
                    runningTask.execution.onDidClose(e => res(typeof e === "number" ? e : -1))
                );
            });
            const exitCode = await exitPromise;
            await endPromise;
            await new Promise(r => setTimeout(r, 500));
            disposables.forEach(d => d.dispose());
            res({
                output,
                exitCode,
            });
        })
    );
    await vscode.tasks.executeTask(task);
    return await promise;
}
// export async function executeTaskAndWaitForResult(
//     fixture: SwiftTaskFixture | SwiftTask,
//     expectOutput: boolean = true
// ): Promise<{ exitCode?: number; output: string }> {
//     const task = "task" in fixture ? fixture.task : fixture;
//     // const exitPromise = waitForEndTaskProcess(task);
//     const writePromise = expectOutput ? waitForWrite(task.execution) : Promise.resolve();
//     writePromise;
//     const promise: Promise<{ exitCode?: number; output: string }> = new Promise(
//         res =>
//             vscode.tasks.onDidEndTaskProcess(async e => {
//                 const runningTask = e.execution.task as SwiftTask;
//                 if (runningTask.detail !== task.detail) {
//                     return;
//                 }
//                 res({
//                     output: runningTask.execution.swiftProcess.getOutput(),
//                     exitCode: e.exitCode,
//                 });
//             })
//         // vscode.tasks.onDidStartTask(async ({ execution }) => {
//         // let output = "";
//         // const runningTask = execution.task as SwiftTask;
//         // if (runningTask.detail !== task.detail) {
//         //     return;
//         // }
//         // const runningWritePromise = expectOutput
//         //     ? waitForWrite(runningTask.execution)
//         //     : Promise.resolve();
//         // const runningExitPromise = waitForEndTaskProcess(runningTask);
//         // const disposables = [
//         //     runningTask.execution.onDidWrite(e => {
//         //         output += e;
//         //         console.log("onDidWrite: " + e);
//         //     }),
//         // ];
//         // const exitCode = await Promise.race([exitPromise, runningExitPromise]);
//         // await Promise.race([writePromise, runningWritePromise]);
//         //     disposables.forEach(d => d.dispose());
//         //     res({
//         //         output,
//         //         exitCode,
//         //     });
//         // })
//     );
//     await vscode.tasks.executeTask(task);
//     return await promise;
// }

/**
 * Wait for the writeable fixture to write some output
 *
 * @param fixture {@link SwiftTaskFixture} or {@link SwiftTask}
 * @returns The string that was written
 */
export async function waitForWrite(fixture: { onDidWrite: vscode.Event<string> }): Promise<string> {
    return new Promise<string>(res => {
        let disposable: vscode.Disposable | undefined = undefined;
        disposable = fixture.onDidWrite(e => {
            disposable?.dispose();
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
export function waitForNoRunningTasks(options?: { timeout: number }): Promise<void> {
    return new Promise<void>((res, reject) => {
        if (vscode.tasks.taskExecutions.length === 0) {
            res();
            return;
        }
        let timeout: NodeJS.Timeout;
        const disposable = vscode.tasks.onDidEndTask(() => {
            if (vscode.tasks.taskExecutions.length > 0) {
                return;
            }
            disposable?.dispose();
            clearTimeout(timeout);
            res();
        });
        if (options?.timeout) {
            timeout = setTimeout(() => {
                disposable.dispose();
                const runningTasks = vscode.tasks.taskExecutions.map(e => e.task.name);
                reject(
                    new Error(
                        `Timed out waiting for tasks to complete. The following ${runningTasks.length} tasks are still running: ${runningTasks}.`
                    )
                );
            }, options.timeout);
        }
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

/**
 * Ideally we would want to use {@link executeTaskAndWaitForResult} but that
 * requires the tests creating the task through some means. If the
 * {@link vscode.Task Task}, was provided by the extension under test, the
 * {@link SwiftTask.execution} event emitters never seem to fire.
 *
 * @param task task to listen for exit event
 */
export function waitForEndTask(task: vscode.Task): Promise<void> {
    return new Promise<void>(res => {
        const disposables: vscode.Disposable[] = [];
        disposables.push(
            vscode.tasks.onDidEndTask(e => {
                if (task.detail !== e.execution.task.detail) {
                    return;
                }
                disposables.forEach(d => d.dispose());
                res();
            })
        );
    });
}

/**
 * Cleans the provided output stripping ansi and
 * cleaning extra whitespace
 *
 * @param output
 * @returns cleaned output
 */
export function cleanOutput(output: string) {
    return stripAnsi(output).trim();
}
