import * as vscode from "vscode";
import { FolderContext } from "../FolderContext";
import { WorkspaceContext } from "../WorkspaceContext";
import { execSwift, poll } from "../utilities/utilities";

export interface SwiftOperationOptions {
    // Should I show a status item
    showStatusItem: boolean;
    // Should I check if an instance of this task is already running
    checkAlreadyRunning: boolean;
    // log output
    log?: string;
}
/** Swift operation to add to TaskQueue */
export interface SwiftOperation {
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
        return this.task.group === vscode.TaskGroup.Build;
    }

    run(
        workspaceContext: WorkspaceContext,
        token?: vscode.CancellationToken
    ): Promise<number | undefined> {
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

    async run(workspaceContext: WorkspaceContext): Promise<number | undefined> {
        const { stdout, stderr } = await execSwift(
            this.args,
            workspaceContext.toolchain ?? "default",
            { cwd: this.folderContext.folder.fsPath },
            this.folderContext
        );
        await this.process(stdout, stderr);
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
export class TaskQueue {
    queue: QueuedOperation[];
    activeOperation?: QueuedOperation;
    workspaceContext: WorkspaceContext;
    disabled: boolean;

    constructor(private folderContext: FolderContext) {
        this.queue = [];
        this.workspaceContext = folderContext.workspaceContext;
        this.activeOperation = undefined;
        this.disabled = false;
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
        // do we already have a version of this operation in the queue. If so
        // return the promise for when that operation is complete instead of adding
        // a new operation
        let queuedOperation = this.findQueuedOperation(operation);
        if (queuedOperation && queuedOperation.promise !== undefined) {
            return queuedOperation.promise;
        }
        // if checkAlreadyRunning is set then check the active operation is not the same
        if (
            operation.options.checkAlreadyRunning === true &&
            this.activeOperation &&
            this.activeOperation.promise &&
            this.activeOperation.id === operation.id
        ) {
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
            this.processQueue();
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
                //const task = operation.task;
                this.activeOperation = operation;
                // show active task status item
                if (operation.showStatusItem === true) {
                    this.workspaceContext.statusItem.start(operation.operation.statusItemId);
                }
                // wait while queue is disabled before running task
                await this.waitWhileDisabled();
                // log start
                if (operation.log) {
                    this.workspaceContext.outputChannel.logStart(
                        `${operation.log} ... `,
                        this.folderContext.name
                    );
                }
                operation
                    .run(this.workspaceContext)
                    .then(result => {
                        // log result
                        if (operation.log) {
                            switch (result) {
                                case 0:
                                    this.workspaceContext.outputChannel.logEnd("done.");
                                    break;
                                case undefined:
                                    this.workspaceContext.outputChannel.logEnd("cancelled.");
                                    break;
                                default:
                                    this.workspaceContext.outputChannel.logEnd("failed.");
                                    break;
                            }
                        }
                        this.finishTask(operation, { success: result });
                    })
                    .catch(error => {
                        // log error
                        if (operation.log) {
                            this.workspaceContext.outputChannel.logEnd(
                                `${operation.log}: ${error}`,
                                this.folderContext.name
                            );
                        }
                        this.finishTask(operation, { fail: error });
                    });
            }
        }
    }

    private finishTask(operation: QueuedOperation, result: TaskQueueResult) {
        operation.cb(result);
        if (operation.showStatusItem === true) {
            this.workspaceContext.statusItem.end(operation.operation.statusItemId);
        }
        this.activeOperation = undefined;
        this.processQueue();
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
        await poll(() => !this.disabled, 1000);
    }
}
