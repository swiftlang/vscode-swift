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
import * as path from "path";
import { FolderContext } from "./FolderContext";
import { StatusItem } from "./ui/StatusItem";
import { SwiftOutputChannel } from "./ui/SwiftOutputChannel";
import {
    execSwift,
    getSwiftExecutable,
    getXCTestPath,
    pathExists,
    isPathInsidePath,
} from "./utilities/utilities";
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
    public currentFolder: FolderContext | null | undefined;
    public outputChannel: SwiftOutputChannel;
    public statusItem: StatusItem;
    public xcTestPath?: string;
    public languageClientManager: LanguageClientManager;
    public swiftVersion: Version;
    private onChangeConfig: vscode.Disposable;

    public constructor(
        public extensionContext: SwiftExtensionContext,
        swiftVersion = "Swift version 0.0.0"
    ) {
        this.outputChannel = new SwiftOutputChannel();
        this.statusItem = new StatusItem();
        this.swiftVersion =
            WorkspaceContext.extractSwiftVersion(swiftVersion) ?? new Version(0, 0, 0);
        this.languageClientManager = new LanguageClientManager(this);
        this.outputChannel.log(swiftVersion);
        // on change config restart server
        this.onChangeConfig = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("swift.path")) {
                vscode.window
                    .showInformationMessage(
                        "Changing the Swift path requires the project be reloaded.",
                        "Ok"
                    )
                    .then(selected => {
                        if (selected === "Ok") {
                            vscode.commands.executeCommand("workbench.action.reloadWindow");
                        }
                    });
            }
        });
    }

    dispose() {
        this.folders.forEach(f => f.dispose());
        this.onChangeConfig.dispose();
        this.languageClientManager.dispose();
        this.outputChannel.dispose();
        this.statusItem.dispose();
    }

    /** Get swift version and create WorkspaceContext */
    static async create(extensionContext: vscode.ExtensionContext): Promise<WorkspaceContext> {
        // get swift version and then create
        const version = await WorkspaceContext.getSwiftVersion();
        return new WorkspaceContext(extensionContext, version);
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
        const onDidChangeActiveWindow = vscode.window.onDidChangeActiveTextEditor(async editor => {
            if (this === undefined) {
                console.log("Trying to run onDidChangeWorkspaceFolders on deleted context");
                return;
            }
            await this.focusTextEditor(editor);
        });
        this.extensionContext.subscriptions.push(onWorkspaceChange, onDidChangeActiveWindow);
    }

    /** Add workspace folders at initialisation */
    async addWorkspaceFolders() {
        // add workspace folders, already loaded
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            for (const folder of vscode.workspace.workspaceFolders) {
                await this.addWorkspaceFolder(folder);
            }
        }
        // fire focus event on null folder to startup language server if we don't have a currently focused folder
        if (this.currentFolder === undefined) {
            await this.fireEvent(null, FolderEvent.focus);
        }
    }

    /**
     * Fire an event to all folder observers
     * @param folder folder to fire event for
     * @param event event type
     */
    async fireEvent(folder: FolderContext | null, event: FolderEvent) {
        for (const observer of this.observers) {
            await observer(folder, event, this);
        }
    }

    /**
     * set the focus folder
     * @param folder folder that has gained focus, you can have a null folder
     */
    async focusFolder(folderContext: FolderContext | null) {
        // null and undefined mean different things here. Undefined means nothing
        // has been setup, null means we want to send focus events but for a null
        // folder
        if (folderContext === this.currentFolder) {
            return;
        }

        // send unfocus event for previous folder observers
        if (this.currentFolder !== undefined) {
            await this.fireEvent(this.currentFolder, FolderEvent.unfocus);
        }
        this.currentFolder = folderContext;

        // send focus event to all observers
        await this.fireEvent(folderContext, FolderEvent.focus);
    }

    /**
     * catch workspace folder changes and add or remove folders based on those changes
     * @param event workspace folder event
     */
    async onDidChangeWorkspaceFolders(event: vscode.WorkspaceFoldersChangeEvent) {
        for (const folder of event.added) {
            await this.addWorkspaceFolder(folder);
        }

        for (const folder of event.removed) {
            await this.removeFolder(folder);
        }
    }

    /**
     * Called whenever a folder is added to the workspace
     * @param folder folder being added
     */
    async addWorkspaceFolder(folder: vscode.WorkspaceFolder) {
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
        // add folder if Package.swift exists
        if (await pathExists(folder.uri.fsPath, "Package.swift")) {
            await this.addPackageFolder(folder.uri, folder);
        }

        if (this.getActiveWorkspaceFolder(vscode.window.activeTextEditor) === folder) {
            this.focusTextEditor(vscode.window.activeTextEditor);
        }
    }

    async addPackageFolder(
        folder: vscode.Uri,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<FolderContext> {
        const folderContext = await FolderContext.create(folder, workspaceFolder, this);
        this.folders.push(folderContext);

        await this.fireEvent(folderContext, FolderEvent.add);

        return folderContext;
    }

    /**
     * called when a folder is removed from workspace
     * @param folder folder being removed
     */
    async removeFolder(folder: vscode.WorkspaceFolder) {
        // find context with root folder
        const index = this.folders.findIndex(context => context.workspaceFolder === folder);
        if (index === -1) {
            console.error(`Trying to delete folder ${folder} which has no record`);
            return;
        }
        const context = this.folders[index];
        // if current folder is this folder send unfocus event by setting
        // current folder to undefined
        if (this.currentFolder === context) {
            this.focusFolder(null);
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

    /** Return swift version string returned by `swift --version` */
    private static async getSwiftVersion(): Promise<string> {
        try {
            const { stdout } = await execSwift(["--version"]);
            const version = stdout.split("\n", 1)[0];
            return version;
        } catch {
            throw Error("Cannot find swift executable.");
        }
    }

    /** extract Swift version from Version string returned by `swift --version` */
    private static extractSwiftVersion(versionString: string): Version | undefined {
        // extract version
        const match = versionString.match(/Swift version ([\S]+)/);
        if (match) {
            return Version.fromString(match[1]);
        }
        return undefined;
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

    async focusTextEditor(editor?: vscode.TextEditor) {
        if (!editor || !editor.document) {
            return;
        }
        const url = editor.document.uri;

        const packageFolder = await this.getPackageFolder(url);
        if (packageFolder instanceof FolderContext) {
            this.focusFolder(packageFolder);
        } else if (packageFolder instanceof vscode.Uri) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(packageFolder);
            if (!workspaceFolder) {
                return;
            }
            await this.unfocusCurrentFolder();
            const folderContext = await this.addPackageFolder(packageFolder, workspaceFolder);
            this.focusFolder(folderContext);
        } else {
            this.focusFolder(null);
        }
    }

    /** return workspace folder from text editor */
    private getWorkspaceFolder(url: vscode.Uri): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.getWorkspaceFolder(url);
    }

    /** return workspace folder from text editor */
    private getActiveWorkspaceFolder(
        editor?: vscode.TextEditor
    ): vscode.WorkspaceFolder | undefined {
        if (!editor || !editor.document) {
            return;
        }
        return vscode.workspace.getWorkspaceFolder(editor.document.uri);
    }

    /** Return Package folder for url.
     *
     * First the functions checks in the currently loaded folders to see if it exists inside
     * one of those. If not then it searches up the tree to find the uppermost folder in the
     * workspace that contains a Package.swift
     */
    private async getPackageFolder(
        url: vscode.Uri
    ): Promise<FolderContext | vscode.Uri | undefined> {
        // is editor document in any of the current FolderContexts
        const folder = this.folders.find(context => {
            return isPathInsidePath(url.fsPath, context.folder.fsPath);
        });
        if (folder) {
            return folder;
        }

        // if not search directory tree for 'Package.swift' files
        const workspaceFolder = this.getWorkspaceFolder(url);
        if (!workspaceFolder) {
            return;
        }
        const workspacePath = workspaceFolder.uri.fsPath;
        let packagePath: string | undefined = undefined;
        let currentFolder = path.dirname(url.fsPath);
        do {
            if (await pathExists(currentFolder, "Package.swift")) {
                packagePath = currentFolder;
            }
            currentFolder = path.dirname(currentFolder);
        } while (currentFolder !== workspacePath);

        if (packagePath) {
            return vscode.Uri.file(packagePath);
        } else {
            return;
        }
    }

    /** send unfocus event to current focussed folder and clear current folder */
    private async unfocusCurrentFolder() {
        // send unfocus event for previous folder observers
        if (this.currentFolder !== undefined) {
            await this.fireEvent(this.currentFolder, FolderEvent.unfocus);
        }
        this.currentFolder = undefined;
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
    folder: FolderContext | null,
    operation: FolderEvent,
    workspace: WorkspaceContext
) => unknown;
