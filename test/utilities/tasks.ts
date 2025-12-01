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
import { AssertionError } from "chai";
import * as vscode from "vscode";

import { SwiftTask } from "@src/tasks/SwiftTaskProvider";

import { SwiftTaskFixture } from "../fixtures";

// eslint-disable-next-line @typescript-eslint/no-require-imports
import stripAnsi = require("strip-ansi");

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
    const exitPromise = waitForEndTaskProcess(task);

    const execution = await vscode.tasks.executeTask(task);

    let output = "";
    const runningTask = execution.task as SwiftTask;
    const disposables = [runningTask.execution.onDidWrite(e => (output += e))];
    const exitCode = await exitPromise;
    disposables.forEach(d => d.dispose());
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
 * Allows for introspection of VS Code tasks that happened while this TaskWatcher is active.
 *
 * **Note:** Use {@link withTaskWatcher} to limit the scope to the duration of a test and clean up
 * listeners upon test completion.
 */
export class TaskWatcher implements vscode.Disposable {
    /** An array containing all of the tasks that have already completed. */
    public completedTasks: vscode.Task[] = [];
    private subscriptions: vscode.Disposable[];

    constructor() {
        this.subscriptions = [
            vscode.tasks.onDidEndTask(event => {
                this.completedTasks.push(event.execution.task);
            }),
        ];
    }

    /** Asserts that a task was completed with the given name. */
    assertTaskCompletedByName(name: string): void {
        if (this.completedTasks.find(t => t.name.includes(name))) {
            return;
        }
        const createStringArray = (arr: string[]): string => {
            return "[\n" + arr.map(s => "  " + s).join(",\n") + "\n]";
        };
        throw new AssertionError(`expected a task with name "${name}" to have completed.`, {
            actual: createStringArray(this.completedTasks.map(t => t.name)),
            expected: createStringArray([name]),
            showDiff: true,
        });
    }

    dispose() {
        this.subscriptions.forEach(s => s.dispose());
    }
}

/** Executes the given callback with a TaskWatcher that listens to the VS Code tasks API for the duration of the callback. */
export async function withTaskWatcher(
    task: (watcher: TaskWatcher) => Promise<void>
): Promise<void> {
    const watcher = new TaskWatcher();
    try {
        await task(watcher);
    } finally {
        watcher.dispose();
    }
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
 * @param task task to listen for start event
 */
export function waitForStartTaskProcess(task: vscode.Task): Promise<void> {
    return new Promise<void>(res => {
        const disposables: vscode.Disposable[] = [];
        disposables.push(
            vscode.tasks.onDidStartTaskProcess(e => {
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
