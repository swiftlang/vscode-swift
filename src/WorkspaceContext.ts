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
import { StatusItem } from "./ui/StatusItem";
import { SwiftOutputChannel } from "./ui/SwiftOutputChannel";
import { execSwift, getSwiftExecutable, getXCTestPath } from "./utilities/utilities";
import { getLLDBLibPath } from "./debugger/lldb";
import { LanguageClientManager } from "./sourcekit-lsp/LanguageClientManager";
import { Version } from "./utilities/version";

export interface SwiftExtensionContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly subscriptions: { dispose(): any }[];
}

/**
 * Context for whole workspace. Holds array of contexts for each workspace folder
 * and the ExtensionContext
 */
export class WorkspaceContext implements vscode.Disposable {
    public folders: FolderContext[] = [];
    public currentFolder?: FolderContext;
    public outputChannel: SwiftOutputChannel;
    public statusItem: StatusItem;
    public xcTestPath?: string;
    public languageClientManager: LanguageClientManager;
    public swiftVersion: Version;

    public constructor(public extensionContext: SwiftExtensionContext) {
        this.outputChannel = new SwiftOutputChannel();
        this.statusItem = new StatusItem();
        this.languageClientManager = new LanguageClientManager(this);
        // initialize swift version to 0.0.1. Will be updated in `reportSwiftVersion`.
        this.swiftVersion = new Version(0, 0, 1);
    }

    dispose() {
        this.folders.forEach(f => f.dispose());
        this.languageClientManager.dispose();
        this.outputChannel.dispose();
        this.statusItem.dispose();
    }

    /** Setup the vscode event listeners to catch folder changes and active window changes */
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

    /**
     * Fire an event to all folder observers
     * @param folder folder to fire event for
     * @param event event type
     */
    async fireEvent(folder: FolderContext, event: FolderEvent) {
        for (const observer of this.observers) {
            await observer(folder, event, this);
        }
    }

    /**
     * set the focus folder
     * @param folder folder that has gained focus
     */
    async focusFolder(folder?: vscode.WorkspaceFolder) {
        const folderContext = this.folders.find(context => context.folder === folder);
        if (folderContext === this.currentFolder) {
            return;
        }

        // send unfocus event for previous folder observers
        if (this.currentFolder) {
            await this.fireEvent(this.currentFolder, FolderEvent.unfocus);
        }
        this.currentFolder = folderContext;
        if (!folderContext) {
            return;
        }

        // send focus event to all observers
        await this.fireEvent(folderContext, FolderEvent.focus);
    }

    /**
     * catch workspace folder changes and add or remove folders based on those changes
     * @param event workspace folder event
     */
    async onDidChangeWorkspaceFolders(event: vscode.WorkspaceFoldersChangeEvent) {
        for (const folder of event.added) {
            await this.addFolder(folder);
        }

        for (const folder of event.removed) {
            await this.removeFolder(folder);
        }
    }

    /**
     * Called whenever a folder is added to the workspace
     * @param folder folder being added
     */
    async addFolder(folder: vscode.WorkspaceFolder) {
        const folderContext = await FolderContext.create(folder, this);
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
        await this.fireEvent(folderContext, FolderEvent.add);

        // if this is the first folder then set a focus event
        if (
            this.folders.length === 1 ||
            this.getWorkspaceFolder(vscode.window.activeTextEditor) === folder
        ) {
            this.focusFolder(folder);
        }
    }

    /**
     * called when a folder is removed from workspace
     * @param folder folder being removed
     */
    async removeFolder(folder: vscode.WorkspaceFolder) {
        // find context with root folder
        const index = this.folders.findIndex(context => context.folder === folder);
        if (index === -1) {
            console.error(`Trying to delete folder ${folder} which has no record`);
            return;
        }
        const context = this.folders[index];
        // if current folder is this folder send unfocus event by setting
        // current folder to undefined
        if (this.currentFolder === context) {
            this.focusFolder(undefined);
        }
        // run observer functions in reverse order when removing
        const observersReversed = [...this.observers];
        observersReversed.reverse();
        for (const observer of observersReversed) {
            await observer(context, FolderEvent.remove, this);
        }
        context.dispose();
        // remove context
        this.folders.splice(index, 1);
    }

    /**
     * Add workspace folder event observer
     * @param fn observer function to be called when event occurs
     * @returns disposable object
     */
    observeFolders(fn: WorkspaceFoldersObserver): vscode.Disposable {
        this.observers.add(fn);
        return { dispose: () => this.observers.delete(fn) };
    }

    /** report swift version and throw error if it failed to find swift */
    async reportSwiftVersion() {
        try {
            const { stdout } = await execSwift(["--version"]);
            const version = stdout.trimEnd();
            this.outputChannel.log(version);
            // extract version
            const match = version.match(/Apple Swift version ([\S]+)/);
            if (match) {
                this.swiftVersion = Version.fromString(match[1]) ?? this.swiftVersion;
            }
        } catch (error) {
            throw Error("Cannot find swift executable.");
        }
    }

    /** find LLDB version and setup path in CodeLLDB */
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

/** Workspace Folder events */
export class FolderEvent {
    /** Workspace folder has been added */
    static add = new FolderEvent("add");
    /** Workspace folder has been removed */
    static remove = new FolderEvent("remove");
    /** Workspace folder has gained focus via a file inside the folder becoming the actively edited file */
    static focus = new FolderEvent("focus");
    /** Workspace folder loses focus because another workspace folder gained it */
    static unfocus = new FolderEvent("unfocus");
    /** Package.swift has been updated */
    static packageUpdated = new FolderEvent("packageUpdated");
    /** Package.resolved has been updated */
    static resolvedUpdated = new FolderEvent("resolvedUpdated");

    constructor(private readonly name: string) {
        this.name = name;
    }

    toString() {
        return this.name;
    }
}

/** Workspace Folder observer function */
export type WorkspaceFoldersObserver = (
    folder: FolderContext,
    operation: FolderEvent,
    workspace: WorkspaceContext
) => unknown;
