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
import { getBuildAllTask } from "./tasks/SwiftTaskProvider";
import configuration from "./configuration";
import { FolderContext } from "./FolderContext";
import { TaskOperation } from "./tasks/TaskQueue";

export class BackgroundCompilation implements vscode.Disposable {
    private workspaceFileWatcher?: vscode.FileSystemWatcher;
    private configurationEventDisposable?: vscode.Disposable;
    private validFileTypes = ["swift", "c", "cpp", "h", "hpp", "m", "mm"];
    private disposables: vscode.Disposable[] = [];

    constructor(private folderContext: FolderContext) {
        // We only want to configure the file watcher if background compilation is enabled.
        this.configurationEventDisposable = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("swift.backgroundCompilation", folderContext.folder)) {
                if (configuration.backgroundCompilation) {
                    this.setupFileWatching();
                } else {
                    this.stopFileWatching();
                }
            }
        });

        if (configuration.backgroundCompilation) {
            this.setupFileWatching();
        }
    }

    private setupFileWatching() {
        const fileTypes = this.validFileTypes.join(",");
        const rootFolders = ["Sources", "Tests", "Snippets", "Plugins"].join(",");
        this.disposables.push(
            (this.workspaceFileWatcher = vscode.workspace.createFileSystemWatcher(
                `**/{${rootFolders}}/**/*.{${fileTypes}}`
            ))
        );

        this.disposables.push(
            this.workspaceFileWatcher.onDidChange(() => {
                this.runTask();
            })
        );
    }

    private stopFileWatching() {
        this.disposables.forEach(disposable => disposable.dispose());
    }

    dispose() {
        this.configurationEventDisposable?.dispose();
        this.disposables.forEach(disposable => disposable.dispose());
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
