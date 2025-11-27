//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
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

import { BackgroundCompilation } from "./BackgroundCompilation";
import { LinuxMain } from "./LinuxMain";
import { PackageWatcher } from "./PackageWatcher";
import { SwiftPackage, Target, TargetType } from "./SwiftPackage";
import { TestExplorer } from "./TestExplorer/TestExplorer";
import { TestRunManager } from "./TestExplorer/TestRunManager";
import { TestRunProxy } from "./TestExplorer/TestRunner";
import { FolderOperation, WorkspaceContext } from "./WorkspaceContext";
import configuration from "./configuration";
import { SwiftLogger } from "./logging/SwiftLogger";
import { PlaygroundProvider } from "./playgrounds/PlaygroundProvider";
import { TaskQueue } from "./tasks/TaskQueue";
import { SwiftToolchain } from "./toolchain/toolchain";
import { showToolchainError } from "./ui/ToolchainSelection";
import { isPathInsidePath } from "./utilities/filesystem";

export class FolderContext implements vscode.Disposable {
    public backgroundCompilation: BackgroundCompilation;
    public hasResolveErrors = false;
    public taskQueue: TaskQueue;
    public testExplorer?: TestExplorer;
    public resolvedTestExplorer: Promise<TestExplorer>;
    public playgroundProvider?: PlaygroundProvider;
    private testExplorerResolver?: (testExplorer: TestExplorer) => void;
    private packageWatcher: PackageWatcher;
    private testRunManager: TestRunManager;
    public creationStack?: string;

    /**
     * FolderContext constructor
     * @param folder Workspace Folder
     * @param swiftPackage Swift Package inside the folder
     * @param workspaceContext Workspace context
     */
    private constructor(
        public folder: vscode.Uri,
        public toolchain: SwiftToolchain,
        public linuxMain: LinuxMain,
        public swiftPackage: SwiftPackage,
        public workspaceFolder: vscode.WorkspaceFolder,
        public workspaceContext: WorkspaceContext
    ) {
        this.packageWatcher = new PackageWatcher(this, workspaceContext.logger);
        this.backgroundCompilation = new BackgroundCompilation(this);
        this.taskQueue = new TaskQueue(this);
        this.testRunManager = new TestRunManager();

        // In order to track down why a FolderContext may be created when we don't want one,
        // capture the stack so we can log it if we find a duplicate.
        this.creationStack = new Error().stack;

        // Tests often need to wait for the test explorer to be created before they can run.
        // This promise resolves when the test explorer is created, allowing them to wait for it before starting.
        this.resolvedTestExplorer = new Promise<TestExplorer>(resolve => {
            this.testExplorerResolver = resolve;
        });
    }

    /** dispose of any thing FolderContext holds */
    dispose() {
        this.linuxMain?.dispose();
        this.packageWatcher.dispose();
        this.testExplorer?.dispose();
        this.backgroundCompilation.dispose();
        this.taskQueue.dispose();
    }

    /**
     * Create FolderContext
     * @param folder Folder that Folder Context is being created for
     * @param workspaceContext Workspace context for extension
     * @returns a new FolderContext
     */
    static async create(
        folder: vscode.Uri,
        workspaceFolder: vscode.WorkspaceFolder,
        workspaceContext: WorkspaceContext
    ): Promise<FolderContext> {
        const statusItemText = `Loading Package (${FolderContext.uriName(folder)})`;
        workspaceContext.statusItem.start(statusItemText);

        let toolchain: SwiftToolchain;
        try {
            toolchain = await SwiftToolchain.create(
                workspaceContext.extensionContext.extensionPath,
                folder
            );
        } catch (error) {
            // This error case is quite hard for the user to get in to, but possible.
            // Typically on startup the toolchain creation failure is going to happen in
            // the extension activation in extension.ts. However if they incorrectly configure
            // their path post activation, and add a new folder to the workspace, this failure can occur.
            workspaceContext.logger.error(
                `Failed to discover Swift toolchain for ${FolderContext.uriName(folder)}: ${error}`,
                FolderContext.uriName(folder)
            );
            const userMadeSelection = await showToolchainError(folder);
            if (userMadeSelection) {
                // User updated toolchain settings, retry once
                try {
                    toolchain = await SwiftToolchain.create(
                        workspaceContext.extensionContext.extensionPath,
                        folder
                    );
                    workspaceContext.logger.info(
                        `Successfully created toolchain for ${FolderContext.uriName(folder)} after user selection`,
                        FolderContext.uriName(folder)
                    );
                } catch (retryError) {
                    workspaceContext.logger.error(
                        `Failed to create toolchain for ${FolderContext.uriName(folder)} even after user selection: ${retryError}`,
                        FolderContext.uriName(folder)
                    );
                    // Fall back to global toolchain
                    toolchain = workspaceContext.globalToolchain;
                }
            } else {
                toolchain = workspaceContext.globalToolchain;
            }
        }

        const { linuxMain, swiftPackage } =
            await workspaceContext.statusItem.showStatusWhileRunning(statusItemText, async () => {
                const linuxMain = await LinuxMain.create(folder);
                const swiftPackage = await SwiftPackage.create(
                    folder,
                    toolchain,
                    configuration.disableSwiftPMIntegration
                );
                return { linuxMain, swiftPackage };
            });
        workspaceContext.statusItem.end(statusItemText);

        const folderContext = new FolderContext(
            folder,
            toolchain,
            linuxMain,
            swiftPackage,
            workspaceFolder,
            workspaceContext
        );

        const error = await swiftPackage.error;
        if (error) {
            void vscode.window.showErrorMessage(
                `Failed to load ${folderContext.name}/Package.swift: ${error.message}`
            );
            workspaceContext.logger.info(
                `Failed to load Package.swift: ${error.message}`,
                folderContext.name
            );
        }

        // Start watching for changes to Package.swift, Package.resolved and .swift-version
        await folderContext.packageWatcher.install();

        return folderContext;
    }

    get languageClientManager() {
        return this.workspaceContext.languageClientManager.get(this);
    }

    get name(): string {
        const relativePath = this.relativePath;
        if (relativePath.length === 0) {
            return this.workspaceFolder.name;
        } else {
            return `${this.workspaceFolder.name}/${this.relativePath}`;
        }
    }

    get relativePath(): string {
        return path.relative(this.workspaceFolder.uri.fsPath, this.folder.fsPath);
    }

    get isRootFolder(): boolean {
        return this.workspaceFolder.uri === this.folder;
    }

    get swiftVersion() {
        return this.toolchain.swiftVersion;
    }

    /** reload swift package for this folder */
    async reload() {
        await this.swiftPackage.reload(this.toolchain, configuration.disableSwiftPMIntegration);
    }

    /** reload Package.resolved for this folder */
    async reloadPackageResolved() {
        await this.swiftPackage.reloadPackageResolved();
    }

    /** reload workspace-state.json for this folder */
    async reloadWorkspaceState() {
        await this.swiftPackage.reloadWorkspaceState();
    }

    /** Load Swift Plugins and store in Package */
    async loadSwiftPlugins(logger: SwiftLogger) {
        await this.swiftPackage.loadSwiftPlugins(
            this.toolchain,
            logger,
            configuration.disableSwiftPMIntegration
        );
    }

    /**
     * Fire an event to all folder observers
     * @param event event type
     */
    async fireEvent(event: FolderOperation) {
        await this.workspaceContext.fireEvent(this, event);
    }

    /** Return edited Packages folder */
    editedPackageFolder(identifier: string) {
        return path.join(this.folder.fsPath, "Packages", identifier);
    }

    /** Create Test explorer for this folder */
    addTestExplorer() {
        if (this.testExplorer === undefined) {
            this.testExplorer = new TestExplorer(
                this,
                this.workspaceContext.tasks,
                this.workspaceContext.logger,
                this.workspaceContext.onDidChangeSwiftFiles.bind(this.workspaceContext)
            );
            this.testExplorerResolver?.(this.testExplorer);
        }
        return this.testExplorer;
    }

    /** Remove Test explorer from this folder */
    removeTestExplorer() {
        this.testExplorer?.dispose();
        this.testExplorer = undefined;
    }

    /** Refresh the tests in the test explorer for this folder */
    async refreshTestExplorer() {
        if (this.testExplorer?.controller.resolveHandler) {
            return this.testExplorer.controller.resolveHandler(undefined);
        }
    }

    /** Return `true` if package folder has a test explorer */
    hasTestExplorer() {
        return this.testExplorer !== undefined;
    }

    /** Create Playground provider for this folder */
    addPlaygroundProvider() {
        if (!this.playgroundProvider) {
            this.playgroundProvider = new PlaygroundProvider(this);
        }
        return this.playgroundProvider;
    }

    /** Refresh the tests in the test explorer for this folder */
    async refreshPlaygroundProvider() {
        await this.playgroundProvider?.fetch();
    }

    /** Remove playground provider from this folder */
    removePlaygroundProvider() {
        this.playgroundProvider?.dispose();
        this.playgroundProvider = undefined;
    }

    /** Return `true` if package folder has a playground provider */
    hasPlaygroundProvider() {
        return this.testExplorer !== undefined;
    }

    static uriName(uri: vscode.Uri): string {
        return path.basename(uri.fsPath);
    }

    /**
     * Find testTarget for URI
     * @param uri URI to find target for
     * @returns Target
     */
    async getTestTarget(uri: vscode.Uri, type?: TargetType): Promise<Target | undefined> {
        if (!isPathInsidePath(uri.fsPath, this.folder.fsPath)) {
            return undefined;
        }
        const testTargets = await this.swiftPackage.getTargets(type);
        const target = testTargets.find(element => {
            const relativeUri = path.relative(
                path.join(this.folder.fsPath, element.path),
                uri.fsPath
            );
            return element.sources.find(file => file === relativeUri) !== undefined;
        });
        return target;
    }

    /**
     * Register a new test run
     * @param testRun The test run to register
     * @param folder The folder context
     * @param testKind The kind of test run
     * @param tokenSource The cancellation token source
     */
    public registerTestRun(testRun: TestRunProxy, tokenSource: vscode.CancellationTokenSource) {
        this.testRunManager.registerTestRun(testRun, this, tokenSource);
    }

    /**
     * Returns true if there is an active test run for the given test kind
     * @param testKind The kind of test
     * @returns True if there is an active test run, false otherwise
     */
    hasActiveTestRun() {
        return this.testRunManager.getActiveTestRun(this) !== undefined;
    }

    /**
     * Cancels the active test run for the given test kind
     * @param testKind The kind of test run
     */
    cancelTestRun() {
        this.testRunManager.cancelTestRun(this);
    }

    /**
     * Called whenever we have new document symbols
     */
    onDocumentSymbols(
        document: vscode.TextDocument,
        symbols: vscode.DocumentSymbol[] | null | undefined
    ) {
        const uri = document?.uri;
        if (
            this.testExplorer &&
            symbols &&
            uri &&
            uri.scheme === "file" &&
            isPathInsidePath(uri.fsPath, this.folder.fsPath)
        ) {
            void this.testExplorer.getDocumentTests(this, uri, symbols);
        }
    }

    /**
     * Called whenever we have new document CodeLens
     */
    onDocumentCodeLens(
        document: vscode.TextDocument,
        codeLens: vscode.CodeLens[] | null | undefined
    ) {
        const uri = document?.uri;
        if (
            this.playgroundProvider &&
            codeLens &&
            uri &&
            uri.scheme === "file" &&
            isPathInsidePath(uri.fsPath, this.folder.fsPath)
        ) {
            void this.playgroundProvider.onDocumentCodeLens(document, codeLens);
        }
    }
}

export interface EditedPackage {
    name: string;
    folder: string;
}
