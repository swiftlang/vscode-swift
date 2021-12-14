//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from 'vscode';

/**
 * A {@link vscode.StatusBarItem StatusBarItem} to display the status
 * of tasks run by this extension.
 */
class StatusItem {

    private item: vscode.StatusBarItem;
    private activeTask?: vscode.Task;

    private taskStartedListener: vscode.Disposable;
    private taskEndedListener: vscode.Disposable;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.item.command = `terminal.focus`;

        // We need to `bind(this)` here because the this-context is lost
        // when assigning the methods as event handlers. 
        this.taskStartedListener = vscode.tasks.onDidStartTask(this.onTaskStarted.bind(this));
        this.taskEndedListener = vscode.tasks.onDidEndTask(this.onTaskEnded.bind(this));
    }

    /**
     * Display the progress of the given {@link vscode.Task Task} in the status bar.
     */
    monitor(task: vscode.Task) {
        this.activeTask = task;
    }

    private onTaskStarted(event: vscode.TaskStartEvent) {
        if (event.execution.task === this.activeTask) {
            this.item.text = `$(sync~spin) ${this.activeTask.name}`;
            this.item.show();
        }
    }

    private onTaskEnded(event: vscode.TaskEndEvent) {
        if (event.execution.task === this.activeTask) {
            this.item.hide();
        }
    }
    
    dispose() {
        this.item.dispose();
        this.taskStartedListener.dispose();
        this.taskEndedListener.dispose();
    }
}

/**
 * The global {@link StatusItem} object.
 */
 const statusItem = new StatusItem();
 export default statusItem;
