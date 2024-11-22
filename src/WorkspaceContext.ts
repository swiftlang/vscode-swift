//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as path from "path";
import { FolderContext } from "./FolderContext";
import { StatusItem } from "./ui/StatusItem";
import { SwiftOutputChannel } from "./ui/SwiftOutputChannel";
import { swiftLibraryPathKey, getErrorDescription } from "./utilities/utilities";
import { pathExists, isPathInsidePath } from "./utilities/filesystem";
import { getLLDBLibPath } from "./debugger/lldb";
import { LanguageClientManager } from "./sourcekit-lsp/LanguageClientManager";
import { TemporaryFolder } from "./utilities/tempFolder";
import { TaskManager } from "./tasks/TaskManager";
import { BackgroundCompilation } from "./BackgroundCompilation";
import { makeDebugConfigurations } from "./debugger/launch";
import configuration from "./configuration";
import contextKeys from "./contextKeys";
import { setSnippetContextKey } from "./SwiftSnippets";
import { CommentCompletionProviders } from "./editor/CommentCompletion";
import { DebugAdapter, LaunchConfigType } from "./debugger/debugAdapter";
import { SwiftBuildStatus } from "./ui/SwiftBuildStatus";
import { SwiftToolchain } from "./toolchain/toolchain";
import { DiagnosticsManager } from "./DiagnosticsManager";
import { DocumentationManager } from "./documentation/DocumentationManager";

/**
 * Context for whole workspace. Holds array of contexts for each workspace folder
 * and the ExtensionContext
 */
export class WorkspaceContext implements vscode.Disposable {
    public folders: FolderContext[] = [];
    public currentFolder: FolderContext | null | undefined;
    public currentDocument: vscode.Uri | null;
    public statusItem: StatusItem;
    public buildStatus: SwiftBuildStatus;
    public languageClientManager: LanguageClientManager;
    public tasks: TaskManager;
    public diagnostics: DiagnosticsManager;
    public subscriptions: vscode.Disposable[];
    public commentCompletionProvider: CommentCompletionProviders;
    public documentation: DocumentationManager;
    private lastFocusUri: vscode.Uri | undefined;
    private initialisationFinished = false;

    private constructor(
        extensionContext: vscode.ExtensionContext,
        public tempFolder: TemporaryFolder,
        public outputChannel: SwiftOutputChannel,
        public toolchain: SwiftToolchain
    ) {
        this.statusItem = new StatusItem();
        this.buildStatus = new SwiftBuildStatus(this.statusItem);
        this.languageClientManager = new LanguageClientManager(this);
        this.tasks = new TaskManager(this);
        this.diagnostics = new DiagnosticsManager(this);
        this.documentation = new DocumentationManager(extensionContext, this);
        this.currentDocument = null;
        this.commentCompletionProvider = new CommentCompletionProviders();

        const onChangeConfig = vscode.workspace.onDidChangeConfiguration(async event => {
            // on runtime path config change, regenerate launch.json
            if (event.affectsConfiguration("swift.runtimePath")) {
                if (!this.needToAutoGenerateLaunchConfig()) {
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
                                async ctx => await makeDebugConfigurations(ctx, undefined, true)
                            );
                        }
                    });
            }
            // on change of swift build path, regenerate launch.json
            if (event.affectsConfiguration("swift.buildPath")) {
                if (!this.needToAutoGenerateLaunchConfig()) {
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
                                async ctx => await makeDebugConfigurations(ctx, undefined, true)
                            );
                        }
                    });
            }
        });
        const backgroundCompilationOnDidSave = BackgroundCompilation.start(this);
        const contextKeysUpdate = this.onDidChangeFolders(event => {
            switch (event.operation) {
                case FolderOperation.remove:
                    this.updatePluginContextKey();
                    break;
                case FolderOperation.focus:
                    this.updateContextKeys(event.folder);
                    this.updateContextKeysForFile();
                    break;
                case FolderOperation.unfocus:
                    this.updateContextKeys(event.folder);
                    break;
                case FolderOperation.resolvedUpdated:
                    if (event.folder === this.currentFolder) {
                        this.updateContextKeys(event.folder);
                    }
            }
        });
        // add end of task handler to be called whenever a build task has finished. If
        // it is the build task for this folder then focus on the problems view
        const onDidEndTask = this.tasks.onDidEndTaskProcess(event => {
            const task = event.execution.task;
            if (
                task.group === vscode.TaskGroup.Build &&
                event.exitCode !== 0 &&
                event.exitCode !== undefined &&
                configuration.actionAfterBuildError === "Focus Problems"
            ) {
                vscode.commands.executeCommand("workbench.panel.markers.view.focus");
            }
        });
        const swiftFileWatcher = vscode.workspace.createFileSystemWatcher("**/*.swift");
        swiftFileWatcher.onDidCreate(uri => {
            this.swiftFileObservers.forEach(observer =>
                observer({ uri, operation: FileOperation.created })
            );
        });
        swiftFileWatcher.onDidChange(uri => {
            this.swiftFileObservers.forEach(observer =>
                observer({ uri, operation: FileOperation.changed })
            );
        });
        swiftFileWatcher.onDidDelete(uri => {
            this.swiftFileObservers.forEach(observer =>
                observer({ uri, operation: FileOperation.deleted })
            );
        });

        this.subscriptions = [
            swiftFileWatcher,
            onDidEndTask,
            this.commentCompletionProvider,
            backgroundCompilationOnDidSave,
            contextKeysUpdate,
            onChangeConfig,
            this.tasks,
            this.diagnostics,
            this.documentation,
            this.languageClientManager,
            this.outputChannel,
            this.statusItem,
            this.buildStatus,
        ];
        this.lastFocusUri = vscode.window.activeTextEditor?.document.uri;
    }

    async stop() {
        try {
            await this.languageClientManager.stop();
        } catch {
            // ignore
        }
    }

    dispose() {
        this.folders.forEach(f => f.dispose());
        this.folders.length = 0;
        this.subscriptions.forEach(item => item.dispose());
        this.subscriptions.length = 0;
    }

    get swiftVersion() {
        return this.toolchain.swiftVersion;
    }

    /** Get swift version and create WorkspaceContext */
    static async create(
        extensionContext: vscode.ExtensionContext,
        outputChannel: SwiftOutputChannel,
        toolchain: SwiftToolchain
    ): Promise<WorkspaceContext> {
        const tempFolder = await TemporaryFolder.create();
        return new WorkspaceContext(extensionContext, tempFolder, outputChannel, toolchain);
    }

    /**
     * Update context keys based on package contents
     */
    updateContextKeys(folderContext: FolderContext | null) {
        if (!folderContext || !folderContext.swiftPackage.foundPackage) {
            contextKeys.hasPackage = false;
            contextKeys.packageHasDependencies = false;
            return;
        }
        contextKeys.hasPackage = true;
        contextKeys.packageHasDependencies = folderContext.swiftPackage.dependencies.length > 0;
    }

    /**
     * Update context keys based on package contents
     */
    updateContextKeysForFile() {
        if (this.currentDocument) {
            contextKeys.currentTargetType = this.currentFolder?.swiftPackage.getTarget(
                this.currentDocument?.fsPath
            )?.type;
        } else {
            contextKeys.currentTargetType = undefined;
        }

        // Set context keys that depend on features from SourceKit-LSP
        this.languageClientManager.useLanguageClient(async client => {
            const experimentalCaps = client.initializeResult?.capabilities.experimental;
            if (!experimentalCaps) {
                contextKeys.supportsReindexing = false;
                contextKeys.supportsDocumentationRendering = false;
                return;
            }
            contextKeys.supportsReindexing =
                experimentalCaps["workspace/triggerReindex"] !== undefined;
            contextKeys.supportsDocumentationRendering =
                experimentalCaps["textDocument/renderDocumentation"] !== undefined;
        });

        setSnippetContextKey(this);
    }

    /**
     * Update hasPlugins context key
     */
    updatePluginContextKey() {
        let hasPlugins = false;
        for (const folder of this.folders) {
            if (folder.swiftPackage.plugins.length > 0) {
                hasPlugins = true;
                break;
            }
        }
        contextKeys.packageHasPlugins = hasPlugins;
    }

    /** Setup the vscode event listeners to catch folder changes and active window changes */
    setupEventListeners() {
        // add event listener for when a workspace folder is added/removed
        const onWorkspaceChange = vscode.workspace.onDidChangeWorkspaceFolders(event => {
            if (this === undefined) {
                // eslint-disable-next-line no-console
                console.log("Trying to run onDidChangeWorkspaceFolders on deleted context");
                return;
            }
            this.onDidChangeWorkspaceFolders(event);
        });
        // add event listener for when the active edited text document changes
        const onDidChangeActiveWindow = vscode.window.onDidChangeActiveTextEditor(async editor => {
            if (this === undefined) {
                // eslint-disable-next-line no-console
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
     * @param operation event type
     */
    async fireEvent(folder: FolderContext | null, operation: FolderOperation) {
        for (const observer of this.observers) {
            await observer({ folder, operation, workspace: this });
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
            await this.fireEvent(this.currentFolder, FolderOperation.unfocus);
        }
        this.currentFolder = folderContext;

        // send focus event to all observers
        await this.fireEvent(folderContext, FolderOperation.focus);
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
            await this.removeWorkspaceFolder(folder);
        }
    }

    /**
     * Called whenever a folder is added to the workspace
     * @param folder folder being added
     */
    async addWorkspaceFolder(workspaceFolder: vscode.WorkspaceFolder) {
        await this.searchForPackages(workspaceFolder.uri, workspaceFolder);

        if (this.getActiveWorkspaceFolder(vscode.window.activeTextEditor) === workspaceFolder) {
            await this.focusTextEditor(vscode.window.activeTextEditor);
        }
    }

    async searchForPackages(folder: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder) {
        // add folder if Package.swift/compile_commands.json/compile_flags.txt/buildServer.json exists
        if (await this.isValidWorkspaceFolder(folder.fsPath)) {
            await this.addPackageFolder(folder, workspaceFolder);
            return;
        }
        // should I search sub-folders for more Swift Packages
        if (!configuration.folder(workspaceFolder).searchSubfoldersForPackages) {
            return;
        }

        await vscode.workspace.fs.readDirectory(folder).then(async entries => {
            for (const entry of entries) {
                if (
                    entry[1] === vscode.FileType.Directory &&
                    entry[0][0] !== "." &&
                    entry[0] !== "Packages"
                ) {
                    await this.searchForPackages(
                        vscode.Uri.joinPath(folder, entry[0]),
                        workspaceFolder
                    );
                }
            }
        });
    }

    public async addPackageFolder(
        folder: vscode.Uri,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<FolderContext> {
        // find context with root folder
        const index = this.folders.findIndex(context => context.folder.fsPath === folder.fsPath);
        if (index !== -1) {
            this.outputChannel.log(`Adding package folder ${folder} twice`, "WARN");
            return this.folders[index];
        }
        const folderContext = await FolderContext.create(folder, workspaceFolder, this);
        this.folders.push(folderContext);

        await this.fireEvent(folderContext, FolderOperation.add);

        return folderContext;
    }

    /**
     * called when a folder is removed from workspace
     * @param folder folder being removed
     */
    async removeWorkspaceFolder(workspaceFolder: vscode.WorkspaceFolder) {
        for (const folder of this.folders) {
            if (folder.workspaceFolder !== workspaceFolder) {
                return;
            }
            // if current folder is this folder send unfocus event by setting
            // current folder to undefined
            if (this.currentFolder === folder) {
                this.focusFolder(null);
            }
            // run observer functions in reverse order when removing
            const observersReversed = [...this.observers];
            observersReversed.reverse();
            for (const observer of observersReversed) {
                await observer({ folder, operation: FolderOperation.remove, workspace: this });
            }
            folder.dispose();
        }
        this.folders = this.folders.filter(folder => folder.workspaceFolder !== workspaceFolder);
    }

    onDidChangeFolders(listener: (event: FolderEvent) => unknown): vscode.Disposable {
        this.observers.add(listener);
        return { dispose: () => this.observers.delete(listener) };
    }

    onDidChangeSwiftFiles(listener: (event: SwiftFileEvent) => unknown): vscode.Disposable {
        this.swiftFileObservers.add(listener);
        return { dispose: () => this.swiftFileObservers.delete(listener) };
    }

    /** find LLDB version and setup path in CodeLLDB */
    async setLLDBVersion() {
        // check we are using CodeLLDB
        if (DebugAdapter.getLaunchConfigType(this.swiftVersion) !== LaunchConfigType.CODE_LLDB) {
            return;
        }
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
        const expressions = lldbConfig.get<string>("launch.expressions");
        if (configLLDBPath === libPath && expressions === "native") {
            return;
        }

        // show dialog for setting up LLDB
        vscode.window
            .showInformationMessage(
                "The Swift extension needs to update some CodeLLDB settings to enable debugging features. Do you want to set this up in your global settings or the workspace settings?",
                "Global",
                "Workspace",
                "Cancel"
            )
            .then(result => {
                switch (result) {
                    case "Global":
                        lldbConfig.update("library", libPath, vscode.ConfigurationTarget.Global);
                        lldbConfig.update(
                            "launch.expressions",
                            "native",
                            vscode.ConfigurationTarget.Global
                        );
                        // clear workspace setting
                        lldbConfig.update(
                            "library",
                            undefined,
                            vscode.ConfigurationTarget.Workspace
                        );
                        // clear workspace setting
                        lldbConfig.update(
                            "launch.expressions",
                            undefined,
                            vscode.ConfigurationTarget.Workspace
                        );
                        break;
                    case "Workspace":
                        lldbConfig.update("library", libPath, vscode.ConfigurationTarget.Workspace);
                        lldbConfig.update(
                            "launch.expressions",
                            "native",
                            vscode.ConfigurationTarget.Workspace
                        );
                        break;
                }
            });
    }

    /** set focus based on the file a TextEditor is editing */
    async focusTextEditor(editor?: vscode.TextEditor) {
        await this.focusUri(editor?.document.uri);
    }

    async focusUri(uri?: vscode.Uri) {
        this.currentDocument = uri ?? null;
        this.updateContextKeysForFile();
        if (
            this.currentDocument?.scheme === "file" ||
            this.currentDocument?.scheme === "sourcekit-lsp"
        ) {
            await this.focusPackageUri(this.currentDocument);
        }
    }

    /** set focus based on the file */
    async focusPackageUri(uri: vscode.Uri) {
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
        if (await this.isValidWorkspaceFolder(currentFolder)) {
            packagePath = currentFolder;
        }
        // does Package.swift exist in any parent folders up to the root of the
        // workspace
        while (currentFolder !== workspacePath) {
            currentFolder = path.dirname(currentFolder);
            if (await this.isValidWorkspaceFolder(currentFolder)) {
                packagePath = currentFolder;
            }
        }

        if (packagePath) {
            return vscode.Uri.file(packagePath);
        } else {
            return;
        }
    }

    /**
     * Return if folder is considered a valid root folder ie does it contain a SwiftPM
     * Package.swift or a CMake compile_commands.json, compile_flags.txt, or a BSP buildServer.json.
     */
    async isValidWorkspaceFolder(folder: string): Promise<boolean> {
        return (
            ((await pathExists(folder, "Package.swift")) &&
                !configuration.disableSwiftPMIntegration) ||
            (await pathExists(folder, "compile_commands.json")) ||
            (await pathExists(folder, "compile_flags.txt")) ||
            (await pathExists(folder, "buildServer.json"))
        );
    }

    /** send unfocus event to current focussed folder and clear current folder */
    private async unfocusCurrentFolder() {
        // send unfocus event for previous folder observers
        if (this.currentFolder !== undefined) {
            await this.fireEvent(this.currentFolder, FolderOperation.unfocus);
        }
        this.currentFolder = undefined;
    }

    private needToAutoGenerateLaunchConfig() {
        let autoGenerate = false;
        this.folders.forEach(folder => {
            const requiresAutoGenerate =
                configuration.folder(folder.workspaceFolder).autoGenerateLaunchConfigurations &&
                folder.swiftPackage.executableProducts.length > 0;
            autoGenerate = autoGenerate || requiresAutoGenerate;
        });
        return autoGenerate;
    }

    private observers = new Set<(listener: FolderEvent) => unknown>();
    private swiftFileObservers = new Set<(listener: SwiftFileEvent) => unknown>();
}

/** Workspace Folder Operation types */
export enum FolderOperation {
    // Package folder has been added
    add = "add",
    // Package folder has been removed
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

/** Workspace Folder Event */
export interface FolderEvent {
    operation: FolderOperation;
    workspace: WorkspaceContext;
    folder: FolderContext | null;
}

/** File Operation types */
export enum FileOperation {
    // File has been created
    created = "created",
    // File has been changed
    changed = "changed",
    // File was deleted
    deleted = "deleted",
}

/** Swift File Event */
export interface SwiftFileEvent {
    operation: FileOperation;
    uri: vscode.Uri;
}
