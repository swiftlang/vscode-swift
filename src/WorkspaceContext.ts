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
import { StatusItem } from './StatusItem';
import { SwiftOutputChannel } from './SwiftOutputChannel';
import { execSwift } from './utilities';

// Context for whole workspace. Holds array of contexts for each workspace folder
// and the ExtensionContext
export class WorkspaceContext implements vscode.Disposable {
    public folders: FolderContext[] = [];
    public outputChannel: SwiftOutputChannel;
    public statusItem: StatusItem;

	public constructor(
        public extensionContext: vscode.ExtensionContext
    ) {
        this.outputChannel = new SwiftOutputChannel();
        this.statusItem = new StatusItem();
    }

    dispose() {
        this.folders.forEach(f => f.dispose());
        this.outputChannel.dispose();
        this.statusItem.dispose();
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
        const folderContext = await FolderContext.create(folder, isRootFolder, this);
        this.folders.push(folderContext);
        for (const observer of this.observers) {
            await observer(folderContext, 'add');
        }
    }

    // report swift version and throw error if it failed to find swift
    async reportSwiftVersion() {
        try {
            const { stdout } = await execSwift(['--version'], {});
            const version = stdout.trimEnd();
            this.outputChannel.log(version);
        } catch(error) {
            throw Error("Cannot find swift executable.");
        }
    }

    // remove folder from workspace
    private async removeFolder(folder: vscode.WorkspaceFolder) {
        // find context with root folder
        const index = this.folders.findIndex(context => context.folder === folder);
        if (index === -1) {
            console.error(`Trying to delete folder ${folder} which has no record`);
            return;
        }
        const context = this.folders[index];
        // run observer functions in reverse order when removing
        const observersReversed = [...this.observers];
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