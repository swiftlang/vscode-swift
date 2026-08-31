//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2022-2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as vscode from "vscode";

import { WorkspaceContext } from "../WorkspaceContext";
import { AsyncDisposable, Disposable } from "../utilities/Disposable";
import { withTimeout } from "../utilities/withTimeout";

/** Manage task execution and completion handlers */
export class TaskManager implements AsyncDisposable {
    private isDisposed = false;
    private taskId = 0;
    private activeExecutions: Set<vscode.TaskExecution> = new Set();
    private subscriptions: Disposable[];
    private didEndTaskProcessEmitter = new vscode.EventEmitter<vscode.TaskProcessEndEvent>();
    private taskStartObserver: ((event: vscode.TaskStartEvent) => unknown) | undefined;
    private startingTaskPromise: Promise<void> | undefined;

    constructor(private workspaceContext: WorkspaceContext) {
        this.subscriptions = [
            vscode.tasks.onDidStartTask(event => {
                workspaceContext.logger.debug(`Task started: ${event.execution.task.name}`, {
                    label: "TaskManager",
                });
                if (this.taskStartObserver) {
                    this.taskStartObserver(event);
                }
                // if task is set to disable the task queue then disable it
                if (event.execution.task.definition.disableTaskQueue) {
                    this.disableTaskQueue(event.execution.task, true);
                }
            }),
            vscode.tasks.onDidStartTaskProcess(event => {
                workspaceContext.logger.debug(
                    `Task process started: ${event.execution.task.name}`,
                    { label: "TaskManager" }
                );
            }),
            vscode.tasks.onDidEndTaskProcess(event => {
                workspaceContext.logger.debug(`Task process ended: ${event.execution.task.name}`, {
                    label: "TaskManager",
                });
                this.didEndTaskProcessEmitter.fire(event);
            }),
            vscode.tasks.onDidEndTask(event => {
                workspaceContext.logger.debug(`Task ended: ${event.execution.task.name}`, {
                    label: "TaskManager",
                });
                if (this.activeExecutions.has(event.execution)) {
                    this.activeExecutions.delete(event.execution);
                }
                this.didEndTaskProcessEmitter.fire({
                    execution: event.execution,
                    exitCode: undefined,
                });
                // if task disabled the task queue then re-enable it
                if (event.execution.task.definition.disableTaskQueue) {
                    this.disableTaskQueue(event.execution.task, false);
                }
            }),
        ];
    }

    /**
     * Add handler to be called when either a task process completes or when the task
     * completes without the process finishing.
     *
     * If the task process completes then it provides the return code from the process
     * But if the process doesn't complete the return code is undefined
     */
    onDidEndTaskProcess = this.didEndTaskProcessEmitter.event;

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
                void this.startingTaskPromise.then(() =>
                    this.executeTaskAndResolve(task, resolve, reject, token)
                );
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
        if (this.isDisposed) {
            throw Error("TaskManager is disposed.");
        }
        const disposables = [
            this.onDidEndTaskProcess(event => {
                if (event.execution.task.definition.id === task.definition.id) {
                    disposables.forEach(d => d.dispose());
                    resolve(event.exitCode);
                }
            }),
        ];
        // setup startingTaskPromise to be resolved once task has started
        if (this.startingTaskPromise !== undefined) {
            this.workspaceContext.logger.error(
                "TaskManager: Starting promise should be undefined if we reach here."
            );
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
                this.activeExecutions.add(execution);
                if (token) {
                    disposables.push(
                        token?.onCancellationRequested(() => {
                            execution.terminate();
                            disposables.forEach(d => d.dispose());
                            resolve(undefined);
                        })
                    );
                }
            },
            error => {
                this.workspaceContext.logger.error(`Error executing task: ${error}`);
                disposables.forEach(d => d.dispose());
                this.startingTaskPromise = undefined;
                reject(error);
            }
        );
    }

    /**
     * Terminate every `swift` task that is currently running and wait for VS Code to report
     * that each one has ended.
     */
    private async terminateActiveTasks(): Promise<void> {
        const executions = [...this.activeExecutions];
        if (executions.length === 0) {
            return;
        }
        this.workspaceContext.logger.debug(
            `Terminating running tasks: ${executions.map(e => e.task.name).join(", ")}`,
            { label: "TaskManager" }
        );
        await Promise.all(executions.map(execution => this.terminate(execution)));
    }

    /**
     * Terminate a single task execution, resolving once VS Code reports that it has ended.
     */
    private async terminate(execution: vscode.TaskExecution): Promise<void> {
        const subscriptions: Disposable[] = [];
        await withTimeout(
            `Terminating running task "${execution.task.name}"`,
            () =>
                new Promise<void>(resolve => {
                    subscriptions.push(
                        vscode.tasks.onDidEndTask(event => {
                            if (event.execution === execution) {
                                resolve();
                            }
                        })
                    );
                    execution.terminate();
                }),
            5000
        )
            .catch(error => this.workspaceContext.logger.warn(error))
            .finally(() => subscriptions.forEach(s => s.dispose()));
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

    async dispose() {
        this.isDisposed = true;
        await this.terminateActiveTasks();
        this.subscriptions.forEach(s => s.dispose());
        this.didEndTaskProcessEmitter.dispose();
    }
}
