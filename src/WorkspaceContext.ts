//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2022 the VSCode Swift project authors
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
    pathExists,
    isPathInsidePath,
    swiftLibraryPathKey,
    getErrorDescription,
} from "./utilities/utilities";
import { getLLDBLibPath } from "./debugger/lldb";
import { LanguageClientManager } from "./sourcekit-lsp/LanguageClientManager";
import { TemporaryFolder } from "./utilities/tempFolder";
import { SwiftToolchain } from "./toolchain/toolchain";
import { TaskManager } from "./TaskManager";
import { BackgroundCompilation } from "./BackgroundCompilation";
import { makeDebugConfigurations } from "./debugger/launch";
import configuration from "./configuration";
import contextKeys from "./contextKeys";
import { setSnippetContextKey } from "./SwiftSnippets";

/**
 * Context for whole workspace. Holds array of contexts for each workspace folder
 * and the ExtensionContext
 */
export class WorkspaceContext implements vscode.Disposable {
    public folders: FolderContext[] = [];
    public currentFolder: FolderContext | null | undefined;
    public currentDocument: vscode.Uri | null;
    public outputChannel: SwiftOutputChannel;
    public statusItem: StatusItem;
    public languageClientManager: LanguageClientManager;
    public tasks: TaskManager;
    public subscriptions: { dispose(): unknown }[];
    private lastFocusUri: vscode.Uri | undefined;
    private initialisationFinished = false;

    private constructor(public tempFolder: TemporaryFolder, public toolchain: SwiftToolchain) {
        this.outputChannel = new SwiftOutputChannel();
        this.statusItem = new StatusItem();
        this.languageClientManager = new LanguageClientManager(this);
        this.outputChannel.log(this.toolchain.swiftVersionString);
        this.toolchain.logDiagnostics(this.outputChannel);
        this.tasks = new TaskManager();
        this.currentDocument = null;

        const onChangeConfig = vscode.workspace.onDidChangeConfiguration(event => {
            // on toolchain config change, reload window
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
            // on sdk config change, restart sourcekit-lsp
            if (event.affectsConfiguration("swift.SDK")) {
                // FIXME: There is a bug stopping us from restarting SourceKit-LSP directly.
                // As long as it's fixed we won't need to reload on newer versions.
                vscode.window
                    .showInformationMessage(
                        "Changing the Swift SDK path requires the project be reloaded.",
                        "Ok"
                    )
                    .then(selected => {
                        if (selected === "Ok") {
                            vscode.commands.executeCommand("workbench.action.reloadWindow");
                        }
                    });
            }
            // on runtime path config change, regenerate launch.json
            if (event.affectsConfiguration("swift.runtimePath")) {
                if (!configuration.autoGenerateLaunchConfigurations) {
                    return;
                }
                vscode.window
                    .showInformationMessage(
                        `Launch configurations need to be updated after changing the Swift runtime path. Custom versions of environment variable '${swiftLibraryPathKey()}' may be overridden. Do you want to update?`,
                        "Update",
                        "Cancel"
                    )
                    .then(async selected => {
                        if (selected === "Update") {
                            this.folders.forEach(
                                async ctx => await makeDebugConfigurations(ctx, true)
                            );
                        }
                    });
            }
            // on change of swift build path, regenerate launch.json
            if (event.affectsConfiguration("swift.buildPath")) {
                if (!configuration.autoGenerateLaunchConfigurations) {
                    return;
                }
                vscode.window
                    .showInformationMessage(
                        `Launch configurations need to be updated after changing the Swift build path. Do you want to update?`,
                        "Update",
                        "Cancel"
                    )
                    .then(async selected => {
                        if (selected === "Update") {
                            this.folders.forEach(
                                async ctx => await makeDebugConfigurations(ctx, true)
                            );
                        }
                    });
            }
        });
        const backgroundCompilationOnDidSave = BackgroundCompilation.start(this);
        const contextKeysUpdate = this.observeFolders((folder, event) => {
            switch (event) {
                case FolderEvent.focus:
                    this.updateContextKeys(folder);
                    break;
                case FolderEvent.unfocus:
                    this.updateContextKeys(folder);
                    break;
                case FolderEvent.resolvedUpdated:
                    if (folder === this.currentFolder) {
                        this.updateContextKeys(folder);
                    }
            }
        });
        this.subscriptions = [
            backgroundCompilationOnDidSave,
            contextKeysUpdate,
            onChangeConfig,
            this.tasks,
            this.languageClientManager,
            this.outputChannel,
            this.statusItem,
        ];
    }

    dispose() {
        this.folders.forEach(f => f.dispose());
        this.subscriptions.forEach(item => item.dispose());
    }

    get swiftVersion() {
        return this.toolchain.swiftVersion;
    }

    /** Get swift version and create WorkspaceContext */
    static async create(): Promise<WorkspaceContext> {
        const tempFolder = await TemporaryFolder.create();
        const toolchain = await SwiftToolchain.create();
        return new WorkspaceContext(tempFolder, toolchain);
    }

    /**
     * Update context keys based on package contents
     */
    updateContextKeys(folderContext: FolderContext | null) {
        if (!folderContext || !folderContext.swiftPackage.foundPackage) {
            contextKeys.hasPackage = false;
            contextKeys.packageHasDependencies = false;
            contextKeys.packageHasPlugins = false;
            return;
        }
        contextKeys.hasPackage = true;
        contextKeys.packageHasDependencies = folderContext.swiftPackage.dependencies.length > 0;
        contextKeys.packageHasPlugins = folderContext.swiftPackage.plugins.length > 0;
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
        this.subscriptions.push(onWorkspaceChange, onDidChangeActiveWindow);
    }

    /** Add workspace folders at initialisation */
    async addWorkspaceFolders() {
        // add workspace folders, already loaded
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            for (const folder of vscode.workspace.workspaceFolders) {
                await this.addWorkspaceFolder(folder);
            }
        }
        // If we don't have a current selected folder Start up language server by firing focus event
        // on either null folder or the first folder if there is only one
        if (this.currentFolder === undefined) {
            if (this.folders.length === 1) {
                await this.focusFolder(this.folders[0]);
            } else {
                await this.focusFolder(null);
            }
        }
        this.initialisationComplete();
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
        // add folder if Package.swift exists
        if (await pathExists(folder.uri.fsPath, "Package.swift")) {
            await this.addPackageFolder(folder.uri, folder);
        }

        if (this.getActiveWorkspaceFolder(vscode.window.activeTextEditor) === folder) {
            await this.focusTextEditor(vscode.window.activeTextEditor);
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

    /** find LLDB version and setup path in CodeLLDB */
    async setLLDBVersion() {
        const libPathResult = await getLLDBLibPath(this.toolchain);
        if (!libPathResult.success) {
            // if failure message is undefined then fail silently
            if (!libPathResult.failure) {
                return;
            }
            const errorMessage = `Error: ${getErrorDescription(libPathResult.failure)}`;
            vscode.window.showErrorMessage(
                `Failed to setup CodeLLDB for debugging of Swift code. Debugging may produce unexpected results. ${errorMessage}`
            );
            this.outputChannel.log(`Failed to setup CodeLLDB: ${errorMessage}`);
            return;
        }

        const libPath = libPathResult.success;
        const lldbConfig = vscode.workspace.getConfiguration("lldb");
        const configLLDBPath = lldbConfig.get<string>("library");
        if (configLLDBPath === libPath) {
            return;
        }

        // show dialog for setting up LLDB
        vscode.window
            .showInformationMessage(
                "CodeLLDB requires the correct Swift version of LLDB for debugging. Do you want to set this up in your global settings or the workspace settings?",
                "Global",
                "Workspace",
                "Cancel"
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

    /** set focus based on the file a TextEditor is editing */
    async focusTextEditor(editor?: vscode.TextEditor) {
        if (!editor || !editor.document || editor.document.uri.scheme !== "file") {
            this.currentDocument = null;
            return;
        }
        this.currentDocument = editor.document.uri;
        await this.focusUri(editor.document.uri);
        setSnippetContextKey(this);
    }

    /** set focus based on the file */
    async focusUri(uri: vscode.Uri) {
        const packageFolder = await this.getPackageFolder(uri);
        if (packageFolder instanceof FolderContext) {
            await this.focusFolder(packageFolder);
            // clear last focus uri as we have set focus for a folder that has already loaded
            this.lastFocusUri = undefined;
        } else if (packageFolder instanceof vscode.Uri) {
            if (this.initialisationFinished === false) {
                // If a package takes a long time to load during initialisation, a focus event
                // can occur prior to the package being fully loaded. At this point because the
                // folder for that package isn't setup it will attempt to add the package again.
                // To avoid this if we are still initialising we store the last uri to get focus
                // and once the initialisation is complete we call focusUri again from the function
                // initialisationComplete.
                this.lastFocusUri = uri;
            } else {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(packageFolder);
                if (!workspaceFolder) {
                    return;
                }
                await this.unfocusCurrentFolder();
                const folderContext = await this.addPackageFolder(packageFolder, workspaceFolder);
                await this.focusFolder(folderContext);
            }
        } else {
            await this.focusFolder(null);
        }
    }

    private initialisationComplete() {
        this.initialisationFinished = true;
        if (this.lastFocusUri) {
            this.focusUri(this.lastFocusUri);
            this.lastFocusUri = undefined;
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
        // does Package.swift exist in this folder
        if (await pathExists(currentFolder, "Package.swift")) {
            packagePath = currentFolder;
        }
        // does Package.swift exist in any parent folders up to the root of the
        // workspace
        while (currentFolder !== workspacePath) {
            currentFolder = path.dirname(currentFolder);
            if (await pathExists(currentFolder, "Package.swift")) {
                packagePath = currentFolder;
            }
        }

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
export enum FolderEvent {
    // Workspace folder has been added
    add = "add",
    // Workspace folder has been removed
    remove = "remove",
    // Workspace folder has gained focus via a file inside the folder becoming the actively edited file
    focus = "focus",
    // Workspace folder loses focus because another workspace folder gained it
    unfocus = "unfocus",
    // Package.swift has been updated
    packageUpdated = "packageUpdated",
    // Package.resolved has been updated
    resolvedUpdated = "resolvedUpdated",
}

/** Workspace Folder observer function */
export type WorkspaceFoldersObserver = (
    folder: FolderContext | null,
    operation: FolderEvent,
    workspace: WorkspaceContext
) => unknown;
