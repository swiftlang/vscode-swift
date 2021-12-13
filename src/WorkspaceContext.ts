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
import { FolderContext } from './FolderContext';

// Context for whole workspace. Holds array of contexts for each workspace folder
// and the ExtensionContext
export class WorkspaceContext implements vscode.Disposable {
    public folders: FolderContext[] = [];
    public outputChannel: vscode.OutputChannel;

	public constructor(
        public extensionContext: vscode.ExtensionContext
    ) {
        this.outputChannel = vscode.window.createOutputChannel("Swift");
    }

    dispose() {
        this.folders.forEach(f => f.dispose());
        this.outputChannel.dispose();
    }

    // catch workspace folder changes and add/remove folders based on those changes
    public async onDidChangeWorkspaceFolders(event: vscode.WorkspaceFoldersChangeEvent) {
        for (const folder of event.added) {
            await this.addFolder(folder);
        }

        for (const folder of event.removed) {
            await this.removeFolder(folder);
        }
    } 

    // add folder to workspace
    public async addFolder(folder: vscode.WorkspaceFolder) {
        const isRootFolder = this.folders.length === 0;
        let folderContext = await FolderContext.create(folder, isRootFolder, this);
        this.folders.push(folderContext);
        for (const observer of this.observers) {
            await observer(folderContext, 'add');
        }
    }

    // remove folder from workspace
    private async removeFolder(folder: vscode.WorkspaceFolder) {
        // find context with root folder
        let index = this.folders.findIndex((context: FolderContext, _) => { return context.folder === folder; });
        if (index === -1) {
            console.error(`Trying to delete folder ${folder} which has no record`);
            return;
        }
        const context = this.folders[index];
        // run observer functions in reverse order when removing
        let observersReversed = [...this.observers];
        observersReversed.reverse();
        for (const observer of observersReversed) {
            await observer(context, 'remove');
        }
        context.dispose();
        // remove context
        this.folders = this.folders.splice(index, 1);
    }

    observerFolders(fn: WorkspaceFoldersObserver): vscode.Disposable {
        this.observers.add(fn);
        return { dispose: () => this.observers.delete(fn) };
    }

    private observers: Set<WorkspaceFoldersObserver> = new Set();
}

export type WorkspaceFoldersObserver = (folder: FolderContext, operation: 'add'|'remove') => unknown;