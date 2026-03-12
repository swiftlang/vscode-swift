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

/**
 * Manages progress indicators to display the status
 * of tasks run by this extension.
 */
export class StatusItem {
    /**
     * Display status item while running a process/task
     * @param task Task or process name to display status of
     * @param process Code to run while displaying status
     */
    async showStatusWhileRunning<Return>(
        task: vscode.Task | string,
        process: { (token: vscode.CancellationToken): Return }
    ): Promise<Return> {
        return await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window },
            async (progress, token) => {
                progress.report({ message: StatusItem.statusItemTaskName(task) });
                return await process(token);
            }
        );
    }

    static statusItemTaskName(task: vscode.Task | string) {
        if (typeof task !== "string") {
            return task.name;
        } else {
            return task;
        }
    }
}
