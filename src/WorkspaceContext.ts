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

	public constructor(
        public extensionContext: vscode.ExtensionContext
    ) {
        vscode.workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders);
    }

    dispose() {
        this.folders.forEach((f) => {f.dispose();});
    }

    // catch workspace folder changes and add/remove folders based on those changes
    async onDidChangeWorkspaceFolders(event: vscode.WorkspaceFoldersChangeEvent) {
        for (const folder of event.added) {
            this.addFolder(folder);
        }

        for (const folder of event.removed) {
            this.removeFolder(folder);
        }
    } 

    // add folder to workspace
    public async addFolder(folder: vscode.WorkspaceFolder) {
        const isRootFolder = this.folders.length === 0;
        const folderContext = await FolderContext.create(folder, isRootFolder);
        this.folders.push(folderContext);
    }

    // remove folder from workspace
    removeFolder(folder: vscode.WorkspaceFolder) {
        // find context with root folder
        let context = this.folders.find((context: FolderContext, _) => { context.rootFolder === folder; });
        if (context === undefined) {
            console.error(`Trying to delete folder ${folder} which has no record`);
            return;
        }
        context.dispose();
        // remove context with root folder
        this.folders = this.folders.filter((context: FolderContext, _) => { context.rootFolder !== folder; });
    }
}
