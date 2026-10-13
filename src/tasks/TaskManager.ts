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
    private processIds = new WeakMap<vscode.TaskExecution, number>();
    private pendingExecutions: Set<Promise<unknown>> = new Set();
    private subscriptions: Disposable[];
    private didEndTaskProcessEmitter = new vscode.EventEmitter<vscode.TaskProcessEndEvent>();
    private taskStartObserver: (() => void) | undefined;
    private startingTaskPromise: Promise<void> | undefined;

    constructor(private workspaceContext: WorkspaceContext) {
        this.subscriptions = [
            vscode.tasks.onDidStartTask(event => {
                workspaceContext.logger.debug(`Task started: ${event.execution.task.name}`, {
                    label: "TaskManager",
                });
                if (this.taskStartObserver) {
                    workspaceContext.logger.trace(
                        `Task start observed, releasing starting task promise: ${event.execution.task.name}`,
                        { label: "TaskManager" }
                    );
                    this.taskStartObserver();
                }
                // if task is set to disable the task queue then disable it
                if (event.execution.task.definition.disableTaskQueue) {
                    this.disableTaskQueue(event.execution.task, true);
                }
            }),
            vscode.tasks.onDidStartTaskProcess(event => {
                this.processIds.set(event.execution, event.processId);
                workspaceContext.logger.trace(
                    `Task process started: ${event.execution.task.name}, id=${event.execution.task.definition.id}, pid=${event.processId}`,
                    { label: "TaskManager" }
                );
            }),
            vscode.tasks.onDidEndTaskProcess(event => {
                // The end event doesn't carry the process ID, so pair it with the start event
                workspaceContext.logger.trace(
                    `Task process ended: ${event.execution.task.name}, id=${event.execution.task.definition.id}, pid=${this.processIds.get(event.execution)}, exitCode=${event.exitCode}`,
                    { label: "TaskManager" }
                );
                this.processIds.delete(event.execution);
                this.didEndTaskProcessEmitter.fire(event);
            }),
            vscode.tasks.onDidEndTask(event => {
                workspaceContext.logger.debug(`Task ended: ${event.execution.task.name}`, {
                    label: "TaskManager",
                });
                if (this.activeExecutions.has(event.execution)) {
                    this.activeExecutions.delete(event.execution);
                }
                workspaceContext.logger.trace(
                    `Task ended: ${event.execution.task.name}, id=${event.execution.task.definition.id}, activeExecutions=${this.activeExecutions.size}`,
                    { label: "TaskManager" }
                );
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
        this.workspaceContext.logger.trace(
            `Execute task and wait: ${task.name}, id=${task.definition.id}, scope=${scopeName(task)}, hasToken=${token !== undefined}`,
            { label: "TaskManager" }
        );
        return new Promise<number | undefined>((resolve, reject) => {
            // There is a bug in the vscode task execution code where if you start two
            // tasks with the name but different scopes at the same time the second one
            // will not start. If you wait until the first one has started the second
            // one will run. The startingTaskPromise is setup when a executeTask is
            // called and resolved at the point it actually starts
            if (this.startingTaskPromise) {
                this.workspaceContext.logger.trace(
                    `Waiting for previous task to start: ${task.name}, id=${task.definition.id}`,
                    { label: "TaskManager" }
                );
                void this.startingTaskPromise.then(() => {
                    this.workspaceContext.logger.trace(
                        `Previous task started, executing: ${task.name}, id=${task.definition.id}`,
                        { label: "TaskManager" }
                    );
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
        if (this.isDisposed) {
            this.workspaceContext.logger.trace(
                `TaskManager is disposed, rejecting task: ${task.name}, id=${task.definition.id}`,
                { label: "TaskManager" }
            );
            reject(Error("TaskManager is disposed."));
            return;
        }
        const disposables = [
            this.onDidEndTaskProcess(event => {
                if (event.execution.task.definition.id === task.definition.id) {
                    this.workspaceContext.logger.trace(
                        `Resolving task: ${task.name}, id=${task.definition.id}, exitCode=${event.exitCode}`,
                        { label: "TaskManager" }
                    );
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
        this.workspaceContext.logger.trace(
            `Calling vscode.tasks.executeTask: ${task.name}, id=${task.definition.id}`,
            { label: "TaskManager" }
        );
        const pending = Promise.resolve(vscode.tasks.executeTask(task)).then(
            execution => {
                this.activeExecutions.add(execution);
                this.workspaceContext.logger.trace(
                    `vscode.tasks.executeTask returned: ${task.name}, id=${task.definition.id}, activeExecutions=${this.activeExecutions.size}`,
                    { label: "TaskManager" }
                );
                if (this.isDisposed) {
                    // Disposed while VS Code was still starting the task
                    this.workspaceContext.logger.trace(
                        `TaskManager disposed while task was starting: ${task.name}, id=${task.definition.id}`,
                        { label: "TaskManager" }
                    );
                    disposables.forEach(d => d.dispose());
                    resolve(undefined);
                    return;
                }
                if (token) {
                    this.workspaceContext.logger.trace(
                        `Registering cancellation handler: ${task.name}, id=${task.definition.id}, alreadyCancelled=${token.isCancellationRequested}`,
                        { label: "TaskManager" }
                    );
                    disposables.push(
                        token?.onCancellationRequested(() => {
                            this.workspaceContext.logger.trace(
                                `Cancellation requested, terminating task: ${task.name}, id=${task.definition.id}`,
                                { label: "TaskManager" }
                            );
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
        this.pendingExecutions.add(pending);
        void pending.finally(() => this.pendingExecutions.delete(pending));
    }

    /**
     * Terminate every `swift` task that is currently running and wait for VS Code to report
     * that each one has ended.
     */
    private async terminateActiveTasks(): Promise<void> {
        // A task VS Code hasn't finished starting isn't in `activeExecutions` yet and
        // outlives the extension, running unsupervised.
        this.workspaceContext.logger.trace(
            `Waiting for starting tasks before terminating: pendingExecutions=${this.pendingExecutions.size}`,
            { label: "TaskManager" }
        );
        await withTimeout(
            "Waiting for starting tasks before terminating them",
            () => Promise.allSettled([...this.pendingExecutions]),
            5000
        ).catch(error => this.workspaceContext.logger.warn(error));
        const executions = [...this.activeExecutions];
        if (executions.length === 0) {
            this.workspaceContext.logger.trace("No running tasks to terminate", {
                label: "TaskManager",
            });
            return;
        }
        this.workspaceContext.logger.debug(
            `Terminating running tasks: ${executions.map(e => e.task.name).join(", ")}`,
            { label: "TaskManager" }
        );
        await Promise.all(executions.map(execution => this.terminate(execution)));
        this.workspaceContext.logger.debug("Finished terminating running tasks", {
            label: "TaskManager",
        });
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
                                this.workspaceContext.logger.trace(
                                    `Terminated task ended: ${execution.task.name}`,
                                    { label: "TaskManager" }
                                );
                                resolve();
                            }
                        })
                    );
                    this.workspaceContext.logger.trace(`Terminating task: ${execution.task.name}`, {
                        label: "TaskManager",
                    });
                    execution.terminate();
                    // VS Code ignores a `terminate()` that is called before the task has finished starting.
                    const retry = setInterval(() => {
                        this.workspaceContext.logger.trace(
                            `Retrying terminate: ${execution.task.name}`,
                            { label: "TaskManager" }
                        );
                        execution.terminate();
                    }, 500);
                    subscriptions.push(new Disposable(() => clearInterval(retry)));
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
            this.workspaceContext.logger.trace(
                `No folder matches task cwd, task queue unchanged: ${task.name}, cwd=${task.definition.cwd}`,
                { label: "TaskManager" }
            );
            return;
        }
        this.workspaceContext.logger.trace(
            `Task queue ${disable ? "disabled" : "enabled"} by task: ${task.name}, folder=${this.workspaceContext.folders[index].name}`,
            { label: "TaskManager" }
        );
        this.workspaceContext.folders[index].taskQueue.disabled = disable;
    }

    async dispose() {
        this.workspaceContext.logger.trace(
            `Disposing TaskManager: activeExecutions=${this.activeExecutions.size}, pendingExecutions=${this.pendingExecutions.size}, taskStarting=${this.startingTaskPromise !== undefined}`,
            { label: "TaskManager" }
        );
        this.isDisposed = true;
        // Release anything queued behind a task that will now never start.
        this.taskStartObserver?.();
        await this.terminateActiveTasks();
        this.subscriptions.forEach(s => s.dispose());
        this.didEndTaskProcessEmitter.dispose();
        this.workspaceContext.logger.trace("TaskManager disposed", { label: "TaskManager" });
    }
}

function scopeName(task: vscode.Task): string {
    if (task.scope === vscode.TaskScope.Workspace || task.scope === vscode.TaskScope.Global) {
        return vscode.TaskScope[task.scope];
    }
    return task.scope?.name ?? "undefined";
}
