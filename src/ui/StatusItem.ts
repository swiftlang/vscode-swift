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

class RunningTask {
    constructor(public task: vscode.Task | string) {}
    get name(): string {
        if (typeof this.task !== "string") {
            return this.task.name;
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
    async showStatusWhileRunning<Return>(
        task: vscode.Task | string,
        process: { (): Return | Promise<Return> }
    ): Promise<Return> {
        this.start(task);
        try {
            return await process();
        } finally {
            this.end(task);
        }
    }

    /**
     * Signals the start of a {@link vscode.Task Task}.
     *
     * Displays the name of the task in the status bar, preceded by a spinner.
     */
    start(task: vscode.Task | string) {
        if (this.runningTasks.findIndex(element => element.task === task) !== -1) {
            return;
        }
        const runningTask = new RunningTask(task);
        this.runningTasks.push(runningTask);
        this.showTask(runningTask);
    }

    /**
     * Updates the status bar message for the running {@link vscode.Task Task}.
     */
    update(task: vscode.Task | string, message: string) {
        const runningTask = this.runningTasks.find(element => element.task === task);
        if (!runningTask) {
            return;
        }
        this.showTask(runningTask, message);
    }

    /**
     * Signals the end of a {@link vscode.Task Task}.
     *
     * If no other tasks are in progress, hides the status bar item. Otherwise
     * the most recently added task is shown.
     */
    end(task: vscode.Task | string) {
        const index = this.runningTasks.findIndex(element => element.task === task);
        if (index === -1) {
            return;
        }
        this.runningTasks.splice(index, 1);
        if (this.runningTasks.length === 0) {
            this.item.hide();
        } else {
            this.showTask(this.runningTasks[this.runningTasks.length - 1]);
        }
    }

    static statusItemTaskName(task: vscode.Task | string) {
        return typeof task === "string" ? task : task.name;
    }

    private showTask(task: RunningTask, message?: string) {
        const text = message ?? task.name;
        const newText = `$(loading~spin) ${text}`;
        // Skip redundant updates so the spinner doesn't flicker on repeated messages.
        if (this.item.text !== newText) {
            this.item.text = newText;
            this.item.accessibilityInformation = { label: text };
        }
        // String "processes" have no terminal to reveal; only real tasks do.
        this.item.command =
            typeof task.task === "string"
                ? undefined
                : {
                      command: "swift.revealTaskTerminal",
                      title: "Reveal Task Terminal",
                      arguments: [task.task],
                  };
        this.item.show();
    }

    dispose() {
        this.item.dispose();
    }
}
