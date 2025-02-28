//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as path from "path";

export class RunningTask {
    constructor(public task: vscode.Task | string) {}
    get name(): string {
        if (typeof this.task !== "string") {
            const folder = this.task.definition.cwd as string;
            if (folder) {
                return `${this.task.name} (${path.basename(folder)})`;
            } else {
                return this.task.name;
            }
        } else {
            return this.task;
        }
    }
}

/**
 * Manages a {@link vscode.StatusBarItem StatusBarItem} to display the status
 * of tasks run by this extension.
 */
export class StatusItem {
    private item: vscode.StatusBarItem;
    private runningTasks: RunningTask[] = [];

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    }

    /**
     * Display status item while running a process/task
     * @param task Task or process name to display status of
     * @param process Code to run while displaying status
     */
    async showStatusWhileRunning<Return>(task: vscode.Task | string, process: { (): Return }) {
        this.start(task);
        try {
            const value = await process();
            this.end(task);
            return value;
        } catch (error) {
            this.end(task);
            throw error;
        }
    }

    /**
     * Signals the start of a {@link vscode.Task Task}.
     *
     * This will display the name of the task, preceded by a spinner animation.
     */
    start(task: vscode.Task | string) {
        if (this.runningTasks.findIndex(element => element.task === task) !== -1) {
            return; // This task is already running.
        }
        const runningTask = new RunningTask(task);
        this.runningTasks.push(runningTask);

        this.showTask(runningTask);
    }

    /**
     * Updates the status bar message for the running {@link vscode.Task Task}.
     *
     * This will display the message, preceded by a spinner animation.
     */
    update(task: vscode.Task | string, message: string) {
        const runningTask = this.runningTasks.find(element => element.task === task);
        if (!runningTask) {
            return; // This task is not running.
        }

        this.showTask(runningTask, message);
    }

    /**
     * Signals the end of a {@link vscode.Task Task}.
     *
     * If no other tasks are in progress, this will hide the {@link vscode.StatusBarItem StatusBarItem}.
     * Otherwise, the most recently added task will be shown instead.
     */
    end(task: vscode.Task | string) {
        const index = this.runningTasks.findIndex(element => element.task === task);
        if (index === -1) {
            return; // Unknown task.
        }
        this.runningTasks.splice(index, 1);
        if (this.runningTasks.length === 0) {
            this.hide();
        } else {
            const taskToDisplay = this.runningTasks[this.runningTasks.length - 1];
            this.showTask(taskToDisplay);
        }
    }

    /**
     * Show status item for task
     * @param task task to show status item for
     */
    private showTask(task: RunningTask, message?: string) {
        message = message ?? task.name;
        if (typeof task.task !== "string") {
            this.show(`$(sync~spin) ${message}`, message, "workbench.action.tasks.showTasks");
        } else {
            this.show(`$(sync~spin) ${message}`, message);
        }
    }

    /**
     * Shows the {@link vscode.StatusBarItem StatusBarItem} with the provided message.
     */
    private show(
        message: string,
        accessibilityMessage: string | undefined = undefined,
        command: string | undefined = undefined
    ) {
        this.item.text = message;
        this.item.accessibilityInformation = { label: accessibilityMessage ?? message };
        this.item.command = command;
        this.item.show();
    }

    /**
     * Hides the {@link vscode.StatusBarItem StatusBarItem}.
     */
    private hide() {
        this.item.hide();
    }

    dispose() {
        this.item.dispose();
    }
}
