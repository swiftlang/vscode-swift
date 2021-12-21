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

import * as vscode from "vscode";
import { FolderContext } from "./FolderContext";
import { StatusItem } from "./StatusItem";
import { SwiftOutputChannel } from "./SwiftOutputChannel";
import { execSwift, getSwiftExecutable, getXCTestPath } from "./utilities";
import { getLLDBLibPath } from "./lldb";

// Context for whole workspace. Holds array of contexts for each workspace folder
// and the ExtensionContext
export class WorkspaceContext implements vscode.Disposable {
    public folders: FolderContext[] = [];
    public currentFolder?: FolderContext;
    public outputChannel: SwiftOutputChannel;
    public statusItem: StatusItem;
    public xcTestPath?: string;

    public constructor(public extensionContext: vscode.ExtensionContext) {
        this.outputChannel = new SwiftOutputChannel();
        this.statusItem = new StatusItem();
    }

    dispose() {
        this.folders.forEach(f => f.dispose());
        this.outputChannel.dispose();
        this.statusItem.dispose();
    }

    setupEventListeners() {
        // add event listener for when a workspace folder is added/removed
        const onWorkspaceChange = vscode.workspace.onDidChangeWorkspaceFolders(event => {
            if (this === undefined) {
                console.log("Trying to run onDidChangeWorkspaceFolders on deleted context");
                return;
            }
            this.onDidChangeWorkspaceFolders(event);
        });
        // add event listener for when the active edited text document changes
        const onDidChangeActiveWindow = vscode.window.onDidChangeActiveTextEditor(editor => {
            if (this === undefined) {
                console.log("Trying to run onDidChangeWorkspaceFolders on deleted context");
                return;
            }

            const workspaceFolder = this.getWorkspaceFolder(editor);
            if (workspaceFolder) {
                this.focusFolder(workspaceFolder);
            }
        });
        this.extensionContext.subscriptions.push(onWorkspaceChange, onDidChangeActiveWindow);
    }

    // set folder focus
    public async focusFolder(folder: vscode.WorkspaceFolder) {
        const folderContext = this.folders.find(context => context.folder === folder);
        if (folderContext === this.currentFolder) {
            return;
        }

        // send unfocus event for previous folder observers
        if (this.currentFolder) {
            for (const observer of this.observers) {
                await observer(this.currentFolder, "unfocus", this);
            }
        }
        this.currentFolder = folderContext;
        if (!folderContext) {
            return;
        }

        // send focus event to all observers
        for (const observer of this.observers) {
            await observer(folderContext, "focus", this);
        }
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
        // On Windows, locate XCTest.dll the first time a folder is added.
        if (process.platform === "win32" && this.folders.length === 1) {
            try {
                this.xcTestPath = await getXCTestPath();
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Unable to create a debug configuration for testing. ` +
                        `Your installation may be corrupt. ${error}`
                );
            }
        }
        for (const observer of this.observers) {
            await observer(folderContext, "add", this);
        }
        // is this the first folder then set a focus event
        if (
            this.folders.length === 1 ||
            this.getWorkspaceFolder(vscode.window.activeTextEditor) === folder
        ) {
            for (const observer of this.observers) {
                await observer(folderContext, "focus", this);
            }
        }
    }

    // remove folder from workspace
    async removeFolder(folder: vscode.WorkspaceFolder) {
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
            await observer(context, "remove", this);
        }
        context.dispose();
        // remove context
        this.folders.splice(index, 1);
    }

    observerFolders(fn: WorkspaceFoldersObserver): vscode.Disposable {
        this.observers.add(fn);
        return { dispose: () => this.observers.delete(fn) };
    }

    // report swift version and throw error if it failed to find swift
    async reportSwiftVersion() {
        try {
            const { stdout } = await execSwift(["--version"]);
            const version = stdout.trimEnd();
            this.outputChannel.log(version);
        } catch (error) {
            throw Error("Cannot find swift executable.");
        }
    }

    // find LLDB version and setup path in CodeLLDB
    async setLLDBVersion() {
        // don't set LLDB on windows as swift version is not working at the moment
        if (process.platform === "win32") {
            return;
        }
        const libPath = await getLLDBLibPath(getSwiftExecutable("lldb"));
        if (!libPath) {
            return;
        }

        const lldbConfig = vscode.workspace.getConfiguration("lldb");
        const configLLDBPath = lldbConfig.get<string>("library");
        if (configLLDBPath === libPath) {
            return;
        }

        // show dialog for setting up LLDB
        vscode.window
            .showInformationMessage(
                "CodeLLDB requires the correct Swift version of LLDB for debugging. Do you want to set this up in your global settings or the workspace settings?",
                "Cancel",
                "Global",
                "Workspace"
            )
            .then(result => {
                switch (result) {
                    case "Global":
                        lldbConfig.update("library", libPath, vscode.ConfigurationTarget.Global);
                        // clear workspace setting
                        lldbConfig.update(
                            "library",
                            undefined,
                            vscode.ConfigurationTarget.Workspace
                        );
                        break;
                    case "Workspace":
                        lldbConfig.update("library", libPath, vscode.ConfigurationTarget.Workspace);
                        break;
                }
            });
    }

    // return workspace folder from text editor
    private getWorkspaceFolder(editor?: vscode.TextEditor): vscode.WorkspaceFolder | undefined {
        if (!editor || !editor.document) {
            return;
        }
        return vscode.workspace.getWorkspaceFolder(editor.document.uri);
    }

    private observers: Set<WorkspaceFoldersObserver> = new Set();
}

export type WorkspaceFoldersObserver = (
    folder: FolderContext,
    operation: "add" | "remove" | "focus" | "unfocus",
    workspace: WorkspaceContext
) => unknown;
