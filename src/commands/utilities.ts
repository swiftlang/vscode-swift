//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
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
import { TaskOperation } from "../tasks/TaskQueue";
import { FolderOperation } from "../WorkspaceContext";

/**
 * Execute task and show UI while running.
 *
 * @param task The task to execute
 * @param description Task description shown in logs and errors
 * @param folderContext The folder context the task is running in
 * @param showErrors Whether to show errors with a vscode error window
 * @param checkAlreadyRunning Check if the task is already running and skip if true
 * @returns Whether or not the task completed successfully.
 */
export async function executeTaskWithUI(
    task: vscode.Task,
    description: string,
    folderContext: FolderContext,
    showErrors = true,
    checkAlreadyRunning: boolean = false
): Promise<boolean> {
    try {
        const exitCode = await folderContext.taskQueue.queueOperation(
            new TaskOperation(task, {
                showStatusItem: true,
                checkAlreadyRunning,
                log: description,
            })
        );
        if (exitCode === 0) {
            return true;
        } else {
            if (showErrors) {
                vscode.window.showErrorMessage(`${description} failed`);
            }
            return false;
        }
    } catch (error) {
        if (showErrors) {
            vscode.window.showErrorMessage(`${description} failed: ${error}`);
        }
        return false;
    }
}

/**
 * If the folder previously had resolve errors and now no longer does then
 * send a Package.resolved updated event to trigger the display of the package
 * dependencies view.
 * @param result If there were resolve errors in the supplied `FolderContext`
 * @param folderContext The folder to act on
 */
export function updateAfterError(result: boolean, folderContext: FolderContext) {
    const triggerResolvedUpdatedEvent = folderContext.hasResolveErrors;
    // Save if the folder has resolve errors for the next call.
    folderContext.hasResolveErrors = !result;

    if (triggerResolvedUpdatedEvent && !folderContext.hasResolveErrors) {
        folderContext.fireEvent(FolderOperation.resolvedUpdated);
    }
}
