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
import commands from './commands';
import * as debug from './debug';

// Context for whole workspace. Holds array of contexts for each workspace folder
// and the ExtensionContext
export class WorkspaceContext implements vscode.Disposable {
    public folders: FolderContext[] = [];

	public constructor(
        public extensionContext: vscode.ExtensionContext
    ) {}

    dispose() {
        this.folders.forEach(f => f.dispose());
    }

    // catch workspace folder changes and add/remove folders based on those changes
    public async onDidChangeWorkspaceFolders(event: vscode.WorkspaceFoldersChangeEvent) {
        for (const folder of event.added) {
            await this.addFolder(folder);
        }

        for (const folder of event.removed) {
            this.removeFolder(folder);
        }
    } 

    // add folder to workspace
    public async addFolder(folder: vscode.WorkspaceFolder) {
        const isRootFolder = this.folders.length === 0;
        let folderContext = await FolderContext.create(folder, isRootFolder);
        this.folders.push(folderContext);
        this.observers.forEach(async fn => { await fn(folderContext, 'add'); });
    }

    // remove folder from workspace
    removeFolder(folder: vscode.WorkspaceFolder) {
        // find context with root folder
        let context = this.folders.find((context: FolderContext, _) => { return context.rootFolder === folder; });
        if (context === undefined) {
            console.error(`Trying to delete folder ${folder} which has no record`);
            return;
        }
        this.observers.forEach(fn => fn(context!, 'remove'));
        context.dispose();
        // remove context with root folder
        this.folders = this.folders.filter(context => context.rootFolder !== folder);
    }

    observerFolders(fn: (folder: FolderContext, operation: 'add'|'remove') => unknown): vscode.Disposable {
        this.observers.add(fn);
        return { dispose: () => this.observers.delete(fn) };
    }

    private observers: Set<(arg: FolderContext, operation: 'add'|'remove') => unknown> = new Set();
}
