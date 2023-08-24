//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2022-2023 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { WorkspaceContext } from "./WorkspaceContext";

/** Manage task execution and completion handlers */
export class TaskManager implements vscode.Disposable {
    constructor(private workspaceContext: WorkspaceContext) {
        this.onDidEndTaskProcessDisposible = vscode.tasks.onDidEndTaskProcess(event => {
            this.taskEndObservers.forEach(observer => observer(event));
        });
        this.onDidEndTaskDisposible = vscode.tasks.onDidEndTask(event => {
            this.taskEndObservers.forEach(observer =>
                observer({ execution: event.execution, exitCode: undefined })
            );
            // if task disabled the task queue then re-enable it
            if (event.execution.task.definition.disableTaskQueue) {
                this.disableTaskQueue(event.execution.task, false);
            }
        });
        this.onDidStartTaskDisposible = vscode.tasks.onDidStartTask(event => {
            if (this.taskStartObserver) {
                this.taskStartObserver(event);
            }
            // if task is set to disable the task queue then disable it
            if (event.execution.task.definition.disableTaskQueue) {
                this.disableTaskQueue(event.execution.task, true);
            }
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
    onDidEndTaskProcess(observer: TaskEndObserver): vscode.Disposable {
        this.taskEndObservers.add(observer);
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
        // set id on definition to catch this task when completing
        task.definition.id = this.taskId;
        this.taskId += 1;
        return new Promise<number | undefined>((resolve, reject) => {
            // There is a bug in the vscode task execution code where if you start two
            // tasks with the name but different scopes at the same time the second one
            // will not start. If you wait until the first one has started the second
            // one will run. The startingTaskPromise is setup when a executeTask is
            // called and resolved at the point it actually starts
            if (this.startingTaskPromise) {
                this.startingTaskPromise.then(() => {
                    this.executeTaskAndResolve(task, resolve, reject, token);
                });
            } else {
                this.executeTaskAndResolve(task, resolve, reject, token);
            }
        });
    }

    private executeTaskAndResolve(
        task: vscode.Task,
        resolve: (result: number | undefined) => void,
        reject: (reason?: Error) => void,
        token?: vscode.CancellationToken
    ) {
        const disposable = this.onDidEndTaskProcess(event => {
            if (event.execution.task.definition.id === task.definition.id) {
                disposable.dispose();
                resolve(event.exitCode);
            }
        });
        // setup startingTaskPromise to be resolved one task has started
        if (this.startingTaskPromise !== undefined) {
            console.warn("TaskManager: Starting promise should be undefined if we reach here.");
        }
        this.startingTaskPromise = new Promise<void>(resolve => {
            this.taskStartObserver = () => {
                this.taskStartObserver = undefined;
                this.startingTaskPromise = undefined;
                resolve();
            };
        });
        vscode.tasks.executeTask(task).then(
            execution => {
                token?.onCancellationRequested(() => {
                    execution.terminate();
                    disposable.dispose();
                    resolve(undefined);
                });
            },
            error => {
                console.log(error);
                disposable.dispose();
                this.startingTaskPromise = undefined;
                reject(error);
            }
        );
    }

    private removeObserver(observer: TaskEndObserver) {
        this.taskEndObservers.delete(observer);
    }

    /** Find folderContext based on task an then disable/enable its task queue */
    private disableTaskQueue(task: vscode.Task, disable: boolean) {
        const index = this.workspaceContext.folders.findIndex(
            context => context.folder.fsPath === task.definition.cwd
        );
        if (index === -1) {
            return;
        }
        this.workspaceContext.folders[index].taskQueue.disabled = disable;
    }

    dispose() {
        this.onDidEndTaskDisposible.dispose();
        this.onDidEndTaskProcessDisposible.dispose();
        this.onDidStartTaskDisposible.dispose();
    }

    private taskEndObservers: Set<TaskEndObserver> = new Set();
    private onDidEndTaskProcessDisposible: vscode.Disposable;
    private onDidEndTaskDisposible: vscode.Disposable;
    private onDidStartTaskDisposible: vscode.Disposable;
    private taskStartObserver: TaskStartObserver | undefined;
    private taskId = 0;
    private startingTaskPromise: Promise<void> | undefined;
}

/** Workspace Folder observer function */
export type TaskStartObserver = (event: vscode.TaskStartEvent) => unknown;
export type TaskEndObserver = (execution: vscode.TaskProcessEndEvent) => unknown;
