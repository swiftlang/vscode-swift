//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2022 the VS Code Swift project authors
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
import { isPathInsidePath } from "./utilities/filesystem";
import { getBuildAllTask } from "./tasks/SwiftTaskProvider";
import configuration from "./configuration";
import { FolderContext } from "./FolderContext";
import { WorkspaceContext } from "./WorkspaceContext";
import { TaskOperation } from "./tasks/TaskQueue";

export class BackgroundCompilation {
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

            // is document a valid type for rebuild
            const languages = ["swift", "c", "cpp", "objective-c", "objective-cpp"];
            let foundLanguage = false;
            languages.forEach(lang => {
                if (event.languageId === lang) {
                    foundLanguage = true;
                }
            });
            if (foundLanguage === false) {
                return;
            }

            // is editor document in any of the current FolderContexts
            const folderContext = workspaceContext.folders.find(context => {
                return isPathInsidePath(event.uri.fsPath, context.folder.fsPath);
            });

            if (!folderContext) {
                return;
            }

            // don't run auto-build if saving Package.swift as it clashes with the resolve
            // that is run after the Package.swift is saved
            if (path.join(folderContext.folder.fsPath, "Package.swift") === event.uri.fsPath) {
                return;
            }

            // run background compilation task
            folderContext.backgroundCompilation.runTask();
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
        const backgroundTask = await getBuildAllTask(this.folderContext);
        if (!backgroundTask) {
            return;
        }
        try {
            await this.folderContext.taskQueue.queueOperation(new TaskOperation(backgroundTask));
        } catch {
            // can ignore if running task fails
        }
    }
}
