import * as vscode from "vscode";
import { FolderContext } from "./FolderContext";
import { WorkspaceContext } from "./WorkspaceContext";

/** Swift operation to add to TaskQueue */
export interface SwiftOperation {
    task: vscode.Task;
}

/**
 * Operation added to queue.
 */
class QueuedOperation {
    public promise?: Promise<number | undefined> = undefined;
    constructor(
        public operation: SwiftOperation,
        public cb: (result: number | undefined) => void,
        public token?: vscode.CancellationToken
    ) {}

    /** Compare queued operation to operation */
    compare(operation: SwiftOperation): boolean {
        const args1: string[] = operation.task.definition.args;
        const args2: string[] = this.operation.task.definition.args;
        if (args1.length !== args2.length) {
            return false;
        }
        return args1.every((value, index) => value === args2[index]);
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

    constructor(private folderContext: FolderContext) {
        this.queue = [];
        this.workspaceContext = folderContext.workspaceContext;
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
        // do we already have a version of this operation in the queue. If so
        // return the promise for when that operation is complete instead of adding
        // a new operation
        let queuedOperation = this.findQueuedOperation(operation);
        if (queuedOperation && queuedOperation.promise !== undefined) {
            return queuedOperation.promise;
        }

        const promise = new Promise<number | undefined>(resolve => {
            queuedOperation = new QueuedOperation(
                operation,
                result => {
                    resolve(result);
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
    private processQueue() {
        if (!this.activeOperation) {
            const operation = this.queue.shift();
            if (operation) {
                this.activeOperation = operation;
                this.workspaceContext.tasks
                    .executeTaskAndWait(operation.operation.task, operation.token)
                    .then(result => {
                        operation.cb(result);
                        this.activeOperation = undefined;
                        this.processQueue();
                    });
            }
        }
    }

    /** Return if we already have an operation in the queue */
    findQueuedOperation(operation: SwiftOperation): QueuedOperation | undefined {
        for (const queuedOperation of this.queue) {
            if (queuedOperation.compare(operation)) {
                return queuedOperation;
            }
        }
    }
}
