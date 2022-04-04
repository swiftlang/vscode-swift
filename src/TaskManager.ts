//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";

/** Manage task execution and completion handlers */
export class TaskManager implements vscode.Disposable {
    constructor() {
        this.onDidEndTaskProcessDisposible = vscode.tasks.onDidEndTaskProcess(event => {
            this.observers.forEach(observer => observer(event));
        });
        this.onDidEndTaskDisposible = vscode.tasks.onDidEndTaskProcess(event => {
            this.observers.forEach(observer =>
                observer({ execution: event.execution, exitCode: undefined })
            );
        });
    }

    /**
     * Add handler to be called when either a task process completes or when the task
     * completes without the process finishing.
     *
     * If the task process completes then it provides the return code from the process
     * But if the process doesn't complete the return code is undefined
     *
     * @param observer function called when task completes
     * @returns disposable handle. Once you have finished with the observer call dispose on this
     */
    onDidEndTaskProcess(observer: TaskObserver): vscode.Disposable {
        this.observers.add(observer);
        return {
            dispose: () => {
                this.removeObserver(observer);
            },
        };
    }

    /**
     * Execute task and wait until it is finished. This function assumes that no
     * other tasks with the same name will be run at the same time
     *
     * @param task task to execute
     * @returns exit code from executable
     */
    async executeTaskAndWait(
        task: vscode.Task,
        token?: vscode.CancellationToken
    ): Promise<number | undefined> {
        return new Promise<number | undefined>(resolve => {
            const disposable = this.onDidEndTaskProcess(event => {
                if (event.execution.task.definition === task.definition) {
                    disposable.dispose();
                    resolve(event.exitCode);
                }
            });
            vscode.tasks.executeTask(task).then(execution => {
                token?.onCancellationRequested(() => {
                    execution.terminate();
                    disposable.dispose();
                    resolve(undefined);
                });
            });
        });
    }

    private removeObserver(observer: TaskObserver) {
        this.observers.delete(observer);
    }

    dispose() {
        this.onDidEndTaskDisposible.dispose();
        this.onDidEndTaskProcessDisposible.dispose();
    }

    private observers: Set<TaskObserver> = new Set();
    private onDidEndTaskProcessDisposible: vscode.Disposable;
    private onDidEndTaskDisposible: vscode.Disposable;
}

/** Workspace Folder observer function */
export type TaskObserver = (execution: vscode.TaskProcessEndEvent) => unknown;
