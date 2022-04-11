//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { isPathInsidePath } from "./utilities/utilities";
import { getBuildAllTask } from "./SwiftTaskProvider";
import configuration from "./configuration";
import { FolderContext } from "./FolderContext";
import { WorkspaceContext } from "./WorkspaceContext";

export class BackgroundCompilation {
    private waitingToRun = false;

    constructor(private folderContext: FolderContext) {}

    /**
     * Start onDidSave handler which will kick off compilation tasks
     *
     * The task works out which folder the saved file is in and then
     * will call `runTask` on the background compilation attached to
     * that folder.
     * */
    static start(workspaceContext: WorkspaceContext): vscode.Disposable {
        const onDidSaveDocument = vscode.workspace.onDidSaveTextDocument(event => {
            if (configuration.backgroundCompilation === false) {
                return;
            }

            // is editor document in any of the current FolderContexts
            const folderContext = workspaceContext.folders.find(context => {
                return isPathInsidePath(event.uri.fsPath, context.folder.fsPath);
            });

            // run background compilation task
            folderContext?.backgroundCompilation.runTask();
        });
        return { dispose: () => onDidSaveDocument.dispose() };
    }

    /**
     * Run background compilation task
     *
     * If task is already running and nobody else is waiting for a build task
     * then wait for the current build task to complete and then run another
     * after. Otherwise just return
     */
    async runTask() {
        // create compile task and execute it
        const task = await getBuildAllTask(this.folderContext);
        if (!task) {
            return;
        }
        const backgroundTask = Object.assign(task);
        backgroundTask.name = `${backgroundTask.name} (Background)`;
        backgroundTask.presentationOptions = {
            reveal: vscode.TaskRevealKind.Never,
            panel: vscode.TaskPanelKind.Dedicated,
        };

        // are there any tasks running inside this folder
        const index = vscode.tasks.taskExecutions.findIndex(
            exe => exe.task.definition.cwd === this.folderContext.folder.fsPath
        );
        if (index !== -1) {
            if (this.waitingToRun) {
                return;
            }
            this.waitingToRun = true;
            // if we found a task then wait until no tasks are running on this folder and then run
            // the build task
            const disposable = this.folderContext.workspaceContext.tasks.onDidEndTaskProcess(
                event => {
                    // find running task, that is running on current folder and is not the one that
                    // just ended
                    const index2 = vscode.tasks.taskExecutions.findIndex(
                        exe =>
                            exe.task.definition.cwd === this.folderContext.folder.fsPath &&
                            exe !== event.execution
                    );
                    if (index2 === -1) {
                        disposable.dispose();
                        vscode.tasks.executeTask(backgroundTask);
                        this.waitingToRun = false;
                    }
                }
            );
            return;
        }

        vscode.tasks.executeTask(backgroundTask);
    }
}
