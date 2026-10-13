//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2022-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { WorkspaceContext } from "../WorkspaceContext";
import { Disposable } from "../utilities/Disposable";
import { execSwift, poll } from "../utilities/utilities";

interface SwiftOperationOptions {
    // Should I show a status item
    showStatusItem: boolean;
    // Should I check if an instance of this task is already running
    checkAlreadyRunning: boolean;
    // log output
    log?: string;
}
/** Swift operation to add to TaskQueue */
interface SwiftOperation {
    // options
    options: SwiftOperationOptions;
    // identifier for statusitem
    statusItemId: vscode.Task | string;
    // operation name
    name: string;
    // internally used identifier
    id: string;
    // is task a build operation
    isBuildOperation: boolean;
    // run operation
    run(
        workspaceContext: WorkspaceContext,
        token: vscode.CancellationToken | undefined
    ): Promise<number | undefined>;
}

/** Operation that wraps a vscode Task */
export class TaskOperation implements SwiftOperation {
    constructor(
        public task: vscode.Task,
        public options: SwiftOperationOptions = {
            showStatusItem: false,
            checkAlreadyRunning: false,
        }
    ) {}

    get name(): string {
        return this.task.name;
    }

    get id(): string {
        let scopeString: string;
        if (
            this.task.scope === vscode.TaskScope.Workspace ||
            this.task.scope === vscode.TaskScope.Global
        ) {
            scopeString = vscode.TaskScope[this.task.scope];
        } else if (this.task.scope) {
            scopeString = `,${this.task.scope.name}`;
        } else {
            scopeString = "*undefined*";
        }
        return this.task.definition.args.join() + scopeString;
    }

    get statusItemId(): vscode.Task | string {
        return this.task;
    }

    get isBuildOperation(): boolean {
        return this.task.group?.id === vscode.TaskGroup.Build.id;
    }

    run(
        workspaceContext: WorkspaceContext,
        token?: vscode.CancellationToken
    ): Promise<number | undefined> {
        if (token?.isCancellationRequested) {
            workspaceContext.logger.trace(`Task cancelled before it ran: ${this.task.name}`, {
                label: "TaskQueue",
            });
            return Promise.resolve(undefined);
        }
        workspaceContext.logger.info(`Exec Task: ${this.task.detail ?? this.task.name}`);
        return workspaceContext.tasks.executeTaskAndWait(this.task, token);
    }
}

/** Operation that runs the swift executable and then parses the result */
export class SwiftExecOperation implements SwiftOperation {
    constructor(
        public args: string[],
        public folderContext: FolderContext,
        public name: string,
        public options: SwiftOperationOptions,
        public process: (stdout: string, stderr: string) => Promise<void> | void
    ) {}

    get id(): string {
        return `${this.args.join()},${this.folderContext?.folder.path}`;
    }

    get statusItemId(): vscode.Task | string {
        return `${this.name} (${this.folderContext.name})`;
    }

    get isBuildOperation(): boolean {
        return false;
    }

    async run(): Promise<number | undefined> {
        const logger = this.folderContext.workspaceContext.logger;
        logger.trace(
            `Exec swift operation: ${this.name}, folder=${this.folderContext.name}, args="${this.args.join(" ")}"`,
            { label: "TaskQueue" }
        );
        const { stdout, stderr } = await execSwift(
            this.args,
            this.folderContext.toolchain,
            { cwd: this.folderContext.folder.fsPath },
            this.folderContext
        );
        logger.trace(
            `Swift operation exited, processing output: ${this.name}, folder=${this.folderContext.name}`,
            { label: "TaskQueue" }
        );
        await this.process(stdout, stderr);
        logger.trace(
            `Swift operation finished processing output: ${this.name}, folder=${this.folderContext.name}`,
            { label: "TaskQueue" }
        );
        return 0;
    }
}

interface TaskQueueResult {
    success?: number;
    fail?: unknown;
}

/**
 * Operation added to queue.
 */
class QueuedOperation {
    get id(): string {
        return this.operation.id;
    }
    get showStatusItem(): boolean {
        return this.operation.options.showStatusItem;
    }
    get log(): string | undefined {
        return this.operation.options.log;
    }

    public promise?: Promise<number | undefined> = undefined;
    constructor(
        public operation: SwiftOperation,
        public cb: (result: TaskQueueResult) => void,
        public token?: vscode.CancellationToken
    ) {}

    run(workspaceContext: WorkspaceContext): Promise<number | undefined> {
        return this.operation.run(workspaceContext, this.token);
    }
}

/**
 * Task queue
 *
 * Queue swift task operations to be executed serially
 */
export class TaskQueue implements Disposable {
    queue: QueuedOperation[];
    activeOperation?: QueuedOperation;
    workspaceContext: WorkspaceContext;
    disabled: boolean;
    private isDisposed: boolean;

    constructor(private folderContext: FolderContext) {
        this.queue = [];
        this.workspaceContext = folderContext.workspaceContext;
        this.activeOperation = undefined;
        this.disabled = false;
        this.isDisposed = false;
    }

    dispose() {
        this.workspaceContext.logger.trace(
            `Disposing task queue: folder=${this.folderContext.name}, dropping ${this.queue.length} queued operation(s), activeOperation=${this.activeOperation?.operation.name ?? "none"}`,
            { label: "TaskQueue" }
        );
        this.isDisposed = true;
        // Settle any operations that will now never run. Leaving them unsettled hangs
        // whoever is awaiting them, e.g. `SwiftPackage.foundPackage`.
        const dropped = this.queue;
        this.queue = [];
        dropped.forEach(operation => operation.cb({}));
        this.activeOperation = undefined;
    }

    /**
     * Add operation to queue
     * @param operation Operation to queue
     * @param token Cancellation token
     * @returns When queued operation is complete
     */
    queueOperation(
        operation: SwiftOperation,
        token?: vscode.CancellationToken
    ): Promise<number | undefined> {
        if (this.isDisposed) {
            this.workspaceContext.logger.trace(
                `Cannot queue operation, task queue disposed: ${operation.name}, folder=${this.folderContext.name}`,
                { label: "TaskQueue" }
            );
            throw Error("TaskQueue has been disposed");
        }
        // do we already have a version of this operation in the queue. If so
        // return the promise for when that operation is complete instead of adding
        // a new operation
        let queuedOperation = this.findQueuedOperation(operation);
        if (queuedOperation && queuedOperation.promise !== undefined) {
            this.workspaceContext.logger.trace(
                `Operation already queued, reusing it: ${operation.name}, folder=${this.folderContext.name}`,
                { label: "TaskQueue" }
            );
            return queuedOperation.promise;
        }
        // if checkAlreadyRunning is set then check the active operation is not the same
        if (
            operation.options.checkAlreadyRunning === true &&
            this.activeOperation &&
            this.activeOperation.promise &&
            this.activeOperation.id === operation.id
        ) {
            this.workspaceContext.logger.trace(
                `Operation already running, reusing it: ${operation.name}, folder=${this.folderContext.name}`,
                { label: "TaskQueue" }
            );
            return this.activeOperation.promise;
        }

        const promise = new Promise<number | undefined>((resolve, fail) => {
            queuedOperation = new QueuedOperation(
                operation,
                result => {
                    if (result.success !== undefined) {
                        resolve(result.success);
                    } else if (result.fail !== undefined) {
                        fail(result.fail);
                    } else {
                        resolve(undefined);
                    }
                },
                token
            );
            this.queue.push(queuedOperation);
            this.workspaceContext.logger.trace(
                `Operation queued: ${operation.name}, folder=${this.folderContext.name}, queueLength=${this.queue.length}, activeOperation=${this.activeOperation?.operation.name ?? "none"}, disabled=${this.disabled}`,
                { label: "TaskQueue" }
            );
            void this.processQueue();
        });
        // if the last item does not have a promise then it is the queue
        // entry we just added above and we should set its promise
        if (this.queue.length > 0 && !this.queue[this.queue.length - 1].promise) {
            this.queue[this.queue.length - 1].promise = promise;
        }
        return promise;
    }

    /** If there is no active operation then run the task at the top of the queue */
    private async processQueue() {
        if (!this.activeOperation) {
            // get task from queue
            const operation = this.queue.shift();

            if (operation) {
                this.activeOperation = operation;
                this.workspaceContext.logger.trace(
                    `Operation dequeued: ${operation.operation.name}, folder=${this.folderContext.name}, queueLength=${this.queue.length}`,
                    { label: "TaskQueue" }
                );
                // wait while queue is disabled before running task
                await this.waitWhileDisabled();
                // the queue may have been disposed of while we were waiting
                if (this.isDisposed) {
                    this.workspaceContext.logger.trace(
                        `Task queue disposed before operation ran: ${operation.operation.name}, folder=${this.folderContext.name}`,
                        { label: "TaskQueue" }
                    );
                    this.finishTask(operation, { fail: Error("TaskQueue has been disposed.") });
                    return;
                }
                // log start
                if (operation.log) {
                    this.workspaceContext.logger.info(`${operation.log}: starting ... `, {
                        label: this.folderContext.name,
                    });
                }
                this.workspaceContext.logger.trace(
                    `Running operation: ${operation.operation.name}, folder=${this.folderContext.name}, showStatusItem=${operation.showStatusItem}`,
                    { label: "TaskQueue" }
                );
                const run = operation.showStatusItem
                    ? this.workspaceContext.statusItem.showStatusWhileRunning(
                          operation.operation.statusItemId,
                          () => operation.run(this.workspaceContext)
                      )
                    : operation.run(this.workspaceContext);
                run.then(result => {
                    this.workspaceContext.logger.trace(
                        `Operation completed: ${operation.operation.name}, folder=${this.folderContext.name}, result=${result}, cancelled=${operation.token?.isCancellationRequested ?? false}`,
                        { label: "TaskQueue" }
                    );
                    // log result
                    if (operation.log && !operation.token?.isCancellationRequested) {
                        if (result === 0) {
                            this.workspaceContext.logger.info(`${operation.log}: ... done.`, {
                                label: this.folderContext.name,
                            });
                        } else {
                            this.workspaceContext.logger.error(`${operation.log}: ... failed.`, {
                                label: this.folderContext.name,
                            });
                        }
                    }
                    this.finishTask(operation, { success: result as number | undefined });
                }).catch(error => {
                    this.workspaceContext.logger.trace(
                        `Operation failed: ${operation.operation.name}, folder=${this.folderContext.name}, error=${error}`,
                        { label: "TaskQueue" }
                    );
                    // log error
                    if (operation.log) {
                        this.workspaceContext.logger.error(`${operation.log}: ${error}`, {
                            label: this.folderContext.name,
                        });
                    }
                    this.finishTask(operation, { fail: error });
                });
            } else {
                this.workspaceContext.logger.trace(
                    `Task queue empty: folder=${this.folderContext.name}`,
                    { label: "TaskQueue" }
                );
            }
        } else {
            this.workspaceContext.logger.trace(
                `Operation already active, not dequeuing: active=${this.activeOperation.operation.name}, folder=${this.folderContext.name}, queueLength=${this.queue.length}`,
                { label: "TaskQueue" }
            );
        }
    }

    private finishTask(operation: QueuedOperation, result: TaskQueueResult) {
        this.workspaceContext.logger.trace(
            `Finishing operation: ${operation.operation.name}, folder=${this.folderContext.name}, queueLength=${this.queue.length}`,
            { label: "TaskQueue" }
        );
        operation.cb(result);
        this.activeOperation = undefined;
        void this.processQueue();
    }

    /** Return if we already have an operation in the queue */
    findQueuedOperation(operation: SwiftOperation): QueuedOperation | undefined {
        for (const queuedOperation of this.queue) {
            if (queuedOperation.id === operation.id) {
                return queuedOperation;
            }
        }
    }

    private async waitWhileDisabled() {
        if (this.disabled) {
            this.workspaceContext.logger.trace(
                `Task queue disabled, waiting before running ${this.activeOperation?.operation.name}: folder=${this.folderContext.name}`,
                { label: "TaskQueue" }
            );
        }
        await poll(() => this.isDisposed || !this.disabled, 1000);
        this.workspaceContext.logger.trace(
            `Finished waiting for task queue: folder=${this.folderContext.name}, disposed=${this.isDisposed}`,
            { label: "TaskQueue" }
        );
    }
}
