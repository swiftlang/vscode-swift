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

import { FolderContext } from "./FolderContext";
import configuration from "./configuration";
import { getBuildAllTask } from "./tasks/SwiftTaskProvider";
import { TaskOperation } from "./tasks/TaskQueue";
import { validFileTypes } from "./utilities/filesystem";

// eslint-disable-next-line @typescript-eslint/no-require-imports
import debounce = require("lodash.debounce");

export class BackgroundCompilation implements vscode.Disposable {
    private workspaceFileWatcher?: vscode.FileSystemWatcher;
    private configurationEventDisposable?: vscode.Disposable;
    private disposables: vscode.Disposable[] = [];

    constructor(private folderContext: FolderContext) {
        // We only want to configure the file watcher if background compilation is enabled.
        this.configurationEventDisposable = vscode.workspace.onDidChangeConfiguration(event => {
            if (
                event.affectsConfiguration(
                    "swift.backgroundCompilation.enabled",
                    folderContext.folder
                )
            ) {
                if (configuration.backgroundCompilation.enabled) {
                    this.setupFileWatching();
                } else {
                    this.stopFileWatching();
                }
            }
        });

        if (configuration.backgroundCompilation.enabled) {
            this.setupFileWatching();
        }
    }

    private setupFileWatching() {
        const fileTypes = validFileTypes.join(",");
        const rootFolders = ["Sources", "Tests", "Snippets", "Plugins"].join(",");
        this.disposables.push(
            (this.workspaceFileWatcher = vscode.workspace.createFileSystemWatcher(
                `**/{${rootFolders}}/**/*.{${fileTypes}}`
            ))
        );

        // Throttle events since many change events can be recieved in a short time if the user
        // does a "Save All" or a process writes several files in quick succession.
        this.disposables.push(
            this.workspaceFileWatcher.onDidChange(
                debounce(
                    () => {
                        void this.runTask();
                    },
                    100 /* 10 times per second */,
                    { trailing: true }
                )
            )
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
        const backgroundTask = await this.getTask();
        if (!backgroundTask) {
            return;
        }
        try {
            await this.folderContext.taskQueue.queueOperation(new TaskOperation(backgroundTask));
        } catch {
            // can ignore if running task fails
        }
    }

    async getTask(): Promise<vscode.Task> {
        return await getBuildAllTask(
            this.folderContext,
            configuration.backgroundCompilation.release,
            configuration.backgroundCompilation.useDefaultTask
        );
    }
}
