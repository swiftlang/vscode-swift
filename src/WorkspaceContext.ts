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
import * as path from "path";
import * as vscode from "vscode";

import { DiagnosticsManager } from "./DiagnosticsManager";
import { FolderContext } from "./FolderContext";
import { setSnippetContextKey } from "./SwiftSnippets";
import { TestKind } from "./TestExplorer/TestKind";
import { TestRunManager } from "./TestExplorer/TestRunManager";
import configuration from "./configuration";
import { ContextKeys } from "./contextKeys";
import { LLDBDebugConfigurationProvider } from "./debugger/debugAdapterFactory";
import { makeDebugConfigurations } from "./debugger/launch";
import { DocumentationManager } from "./documentation/DocumentationManager";
import { CommentCompletionProviders } from "./editor/CommentCompletion";
import { SwiftLogger } from "./logging/SwiftLogger";
import { SwiftLoggerFactory } from "./logging/SwiftLoggerFactory";
import { LanguageClientToolchainCoordinator } from "./sourcekit-lsp/LanguageClientToolchainCoordinator";
import { DocCDocumentationRequest, ReIndexProjectRequest } from "./sourcekit-lsp/extensions";
import { SwiftPluginTaskProvider } from "./tasks/SwiftPluginTaskProvider";
import { SwiftTaskProvider } from "./tasks/SwiftTaskProvider";
import { TaskManager } from "./tasks/TaskManager";
import { BuildFlags } from "./toolchain/BuildFlags";
import { SwiftToolchain } from "./toolchain/toolchain";
import { ProjectPanelProvider } from "./ui/ProjectPanelProvider";
import { StatusItem } from "./ui/StatusItem";
import { SwiftBuildStatus } from "./ui/SwiftBuildStatus";
import { isExcluded, isPathInsidePath } from "./utilities/filesystem";
import { swiftLibraryPathKey } from "./utilities/utilities";
import { isValidWorkspaceFolder, searchForPackages } from "./utilities/workspace";

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
    public languageClientManager: LanguageClientToolchainCoordinator;
    public tasks: TaskManager;
    public diagnostics: DiagnosticsManager;
    public taskProvider: SwiftTaskProvider;
    public pluginProvider: SwiftPluginTaskProvider;
    public launchProvider: LLDBDebugConfigurationProvider;
    public subscriptions: vscode.Disposable[];
    public commentCompletionProvider: CommentCompletionProviders;
    public documentation: DocumentationManager;
    public testRunManager: TestRunManager;
    public projectPanel: ProjectPanelProvider;
    private lastFocusUri: vscode.Uri | undefined;
    private initialisationFinished = false;

    private readonly testStartEmitter = new vscode.EventEmitter<TestEvent>();
    private readonly testFinishEmitter = new vscode.EventEmitter<TestEvent>();

    public onDidStartTests = this.testStartEmitter.event;
    public onDidFinishTests = this.testFinishEmitter.event;

    private readonly buildStartEmitter = new vscode.EventEmitter<BuildEvent>();
    private readonly buildFinishEmitter = new vscode.EventEmitter<BuildEvent>();
    public onDidStartBuild = this.buildStartEmitter.event;
    public onDidFinishBuild = this.buildFinishEmitter.event;

    private observers = new Set<(listener: FolderEvent) => unknown>();
    private swiftFileObservers = new Set<(listener: SwiftFileEvent) => unknown>();

    public loggerFactory: SwiftLoggerFactory;

    constructor(
        extensionContext: vscode.ExtensionContext,
        public contextKeys: ContextKeys,
        public logger: SwiftLogger,
        public globalToolchain: SwiftToolchain
    ) {
        this.testRunManager = new TestRunManager();
        this.loggerFactory = new SwiftLoggerFactory(extensionContext.logUri);
        this.statusItem = new StatusItem();
        this.buildStatus = new SwiftBuildStatus(this.statusItem);
        this.languageClientManager = new LanguageClientToolchainCoordinator(this, {
            onDocumentSymbols: (folder, document, symbols) => {
                folder.onDocumentSymbols(document, symbols);
            },
        });
        this.tasks = new TaskManager(this);
        this.diagnostics = new DiagnosticsManager(this);
        this.taskProvider = new SwiftTaskProvider(this);
        this.pluginProvider = new SwiftPluginTaskProvider(this);
        this.launchProvider = new LLDBDebugConfigurationProvider(process.platform, this, logger);
        this.documentation = new DocumentationManager(extensionContext, this);
        this.currentDocument = null;
        this.commentCompletionProvider = new CommentCompletionProviders();
        this.projectPanel = new ProjectPanelProvider(this);

        const onChangeConfig = vscode.workspace.onDidChangeConfiguration(async event => {
            // Clear build path cache when build-related configurations change
            if (
                event.affectsConfiguration("swift.buildArguments") ||
                event.affectsConfiguration("swift.buildPath") ||
                event.affectsConfiguration("swift.sdk") ||
                event.affectsConfiguration("swift.swiftSDK")
            ) {
                // Clear the build path cache since configuration affects paths
                BuildFlags.clearBuildPathCache();
            }

            // on runtime path config change, regenerate launch.json
            if (event.affectsConfiguration("swift.runtimePath")) {
                if (!(await this.needToAutoGenerateLaunchConfig())) {
                    return;
                }
                void vscode.window
                    .showInformationMessage(
                        `Launch configurations need to be updated after changing the Swift runtime path. Custom versions of environment variable '${swiftLibraryPathKey()}' may be overridden. Do you want to update?`,
                        "Update",
                        "Cancel"
                    )
                    .then(async selected => {
                        if (selected === "Update") {
                            this.folders.forEach(ctx =>
                                makeDebugConfigurations(ctx, { yes: true })
                            );
                        }
                    });
            }
            // on change of swift build path or build arguments, regenerate launch.json
            if (
                event.affectsConfiguration("swift.buildPath") ||
                event.affectsConfiguration("swift.buildArguments")
            ) {
                if (!(await this.needToAutoGenerateLaunchConfig())) {
                    return;
                }
                const configType = event.affectsConfiguration("swift.buildPath")
                    ? "build path"
                    : "build arguments";
                void vscode.window
                    .showInformationMessage(
                        `Launch configurations need to be updated after changing the Swift ${configType}. Do you want to update?`,
                        "Update",
                        "Cancel"
                    )
                    .then(selected => {
                        if (selected === "Update") {
                            this.folders.forEach(ctx =>
                                makeDebugConfigurations(ctx, { yes: true })
                            );
                        }
                    });
            }
        });
        const contextKeysUpdate = this.onDidChangeFolders(event => {
            switch (event.operation) {
                case FolderOperation.remove:
                    this.updatePluginContextKey();
                    break;
                case FolderOperation.focus:
                    this.updateContextKeys(event.folder);
                    void this.updateContextKeysForFile();
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
                void vscode.commands
                    .executeCommand("workbench.panel.markers.view.focus")
                    .then(() => {
                        /* Put in worker queue */
                    });
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
            contextKeysUpdate,
            onChangeConfig,
            this.tasks,
            this.diagnostics,
            this.documentation,
            this.languageClientManager,
            this.logger,
            this.statusItem,
            this.buildStatus,
            this.projectPanel,
        ];
        this.lastFocusUri = vscode.window.activeTextEditor?.document.uri;

        this.setupEventListeners();
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

    get globalToolchainSwiftVersion() {
        return this.globalToolchain.swiftVersion;
    }

    /**
     * Update context keys based on package contents
     */
    updateContextKeys(folderContext: FolderContext | null) {
        if (!folderContext) {
            this.contextKeys.hasPackage = false;
            this.contextKeys.hasExecutableProduct = false;
            this.contextKeys.packageHasDependencies = false;
            return;
        }

        void Promise.all([
            folderContext.swiftPackage.foundPackage,
            folderContext.swiftPackage.executableProducts,
            folderContext.swiftPackage.dependencies,
        ]).then(([foundPackage, executableProducts, dependencies]) => {
            this.contextKeys.hasPackage = foundPackage;
            this.contextKeys.hasExecutableProduct = executableProducts.length > 0;
            this.contextKeys.packageHasDependencies = dependencies.length > 0;
        });
    }

    /**
     * Update context keys based on package contents
     */
    async updateContextKeysForFile() {
        if (this.currentDocument) {
            const target = await this.currentFolder?.swiftPackage.getTarget(
                this.currentDocument?.fsPath
            );
            this.contextKeys.currentTargetType = target?.type;
        } else {
            this.contextKeys.currentTargetType = undefined;
        }

        if (this.currentFolder) {
            const languageClient = this.languageClientManager.get(this.currentFolder);
            await languageClient.useLanguageClient(async client => {
                const experimentalCaps = client.initializeResult?.capabilities.experimental;
                if (!experimentalCaps) {
                    this.contextKeys.supportsReindexing = false;
                    this.contextKeys.supportsDocumentationLivePreview = false;
                    return;
                }
                this.contextKeys.supportsReindexing =
                    experimentalCaps[ReIndexProjectRequest.method] !== undefined;
                this.contextKeys.supportsDocumentationLivePreview =
                    experimentalCaps[DocCDocumentationRequest.method] !== undefined;
            });
        }

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
        this.contextKeys.packageHasPlugins = hasPlugins;
    }

    /** Setup the vscode event listeners to catch folder changes and active window changes */
    private setupEventListeners() {
        // add event listener for when a workspace folder is added/removed
        const onWorkspaceChange = vscode.workspace.onDidChangeWorkspaceFolders(event => {
            if (this === undefined) {
                // eslint-disable-next-line no-console
                console.log("Trying to run onDidChangeWorkspaceFolders on deleted context");
                return;
            }
            void this.onDidChangeWorkspaceFolders(event);
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
        // on the first root folder found in the workspace if there is only one.
        if (this.currentFolder === undefined) {
            const rootFolders = this.folders.filter(folder => folder.isRootFolder);
            if (rootFolders.length === 1) {
                await this.focusFolder(rootFolders[0]);
            } else {
                await this.focusFolder(null);
            }
        }

        await this.initialisationComplete();
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

    public testsFinished(folder: FolderContext, kind: TestKind, targets: string[]) {
        this.testFinishEmitter.fire({ kind, folder, targets });
    }

    public testsStarted(folder: FolderContext, kind: TestKind, targets: string[]) {
        this.testStartEmitter.fire({ kind, folder, targets });
    }

    public buildStarted(
        targetName: string,
        launchConfig: vscode.DebugConfiguration,
        options: vscode.DebugSessionOptions
    ) {
        this.buildStartEmitter.fire({ targetName, launchConfig, options });
    }

    public buildFinished(
        targetName: string,
        launchConfig: vscode.DebugConfiguration,
        options: vscode.DebugSessionOptions
    ) {
        this.buildFinishEmitter.fire({ targetName, launchConfig, options });
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
        const folders = await searchForPackages(
            workspaceFolder.uri,
            configuration.disableSwiftPMIntegration,
            configuration.folder(workspaceFolder).searchSubfoldersForPackages,
            this.globalToolchainSwiftVersion
        );

        for (const folder of folders) {
            await this.addPackageFolder(folder, workspaceFolder);
        }

        if (this.getActiveWorkspaceFolder(vscode.window.activeTextEditor) === workspaceFolder) {
            await this.focusTextEditor(vscode.window.activeTextEditor);
        }
    }

    public async addPackageFolder(
        folder: vscode.Uri,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<FolderContext> {
        // find context with root folder
        const index = this.folders.findIndex(context => context.folder.fsPath === folder.fsPath);
        if (index !== -1) {
            this.logger.warn(`Adding package folder ${folder} twice`);
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
                await this.focusFolder(null);
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

    /** set focus based on the file a TextEditor is editing */
    async focusTextEditor(editor?: vscode.TextEditor) {
        await this.focusUri(editor?.document.uri);
    }

    async focusUri(uri?: vscode.Uri) {
        this.currentDocument = uri ?? null;
        await this.updateContextKeysForFile();
        if (
            this.currentDocument?.scheme === "file" ||
            this.currentDocument?.scheme === "sourcekit-lsp"
        ) {
            await this.focusPackageUri(this.currentDocument);
        }
    }

    /** set focus based on the file */
    async focusPackageUri(uri: vscode.Uri) {
        if (isExcluded(uri)) {
            return;
        }
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

    private async initialisationComplete() {
        this.initialisationFinished = true;
        if (this.lastFocusUri) {
            await this.focusUri(this.lastFocusUri);
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
    async getPackageFolder(url: vscode.Uri): Promise<FolderContext | vscode.Uri | undefined> {
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
        return await isValidWorkspaceFolder(
            folder,
            configuration.disableSwiftPMIntegration,
            this.globalToolchainSwiftVersion
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

    private async needToAutoGenerateLaunchConfig() {
        let autoGenerate = false;
        for (const folder of this.folders) {
            const requiresAutoGenerate =
                configuration.folder(folder.workspaceFolder).autoGenerateLaunchConfigurations &&
                (await folder.swiftPackage.executableProducts).length > 0;
            autoGenerate = autoGenerate || requiresAutoGenerate;
        }
        return autoGenerate;
    }
}

/** Test events for test run begin/end */
interface TestEvent {
    kind: TestKind;
    folder: FolderContext;
    targets: string[];
}

/** Build events for build + run start/stop */
interface BuildEvent {
    targetName: string;
    launchConfig: vscode.DebugConfiguration;
    options: vscode.DebugSessionOptions;
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
    // .build/workspace-state.json has been updated
    workspaceStateUpdated = "workspaceStateUpdated",
    // .build/workspace-state.json has been updated
    packageViewUpdated = "packageViewUpdated",
    // Package plugins list has been updated
    pluginsUpdated = "pluginsUpdated",
    // The folder's swift toolchain version has been updated
    swiftVersionUpdated = "swiftVersionUpdated",
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
