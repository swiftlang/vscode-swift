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

import * as vscode from "vscode";
import * as path from "path";
import { LinuxMain } from "./LinuxMain";
import { PackageWatcher } from "./PackageWatcher";
import { SwiftPackage, Target, TargetType } from "./SwiftPackage";
import { TestExplorer } from "./TestExplorer/TestExplorer";
import { TestRunManager } from "./TestExplorer/TestRunManager";
import { WorkspaceContext, FolderOperation } from "./WorkspaceContext";
import { BackgroundCompilation } from "./BackgroundCompilation";
import { TaskQueue } from "./tasks/TaskQueue";
import { isPathInsidePath } from "./utilities/filesystem";
import { SwiftToolchain } from "./toolchain/toolchain";
import { SwiftLogger } from "./logging/SwiftLogger";
import { TestRunProxy } from "./TestExplorer/TestRunner";

export class FolderContext implements vscode.Disposable {
    public backgroundCompilation: BackgroundCompilation;
    public hasResolveErrors = false;
    public testExplorer?: TestExplorer;
    public taskQueue: TaskQueue;
    private packageWatcher: PackageWatcher;
    private testRunManager: TestRunManager;

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
        this.packageWatcher = new PackageWatcher(this, workspaceContext);
        this.backgroundCompilation = new BackgroundCompilation(this);
        this.taskQueue = new TaskQueue(this);
        this.testRunManager = new TestRunManager();
    }

    /** dispose of any thing FolderContext holds */
    dispose() {
        this.linuxMain?.dispose();
        this.packageWatcher.dispose();
        this.testExplorer?.dispose();
        this.backgroundCompilation.dispose();
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

        const toolchain = await SwiftToolchain.create(folder);
        const { linuxMain, swiftPackage } =
            await workspaceContext.statusItem.showStatusWhileRunning(statusItemText, async () => {
                const linuxMain = await LinuxMain.create(folder);
                const swiftPackage = await SwiftPackage.create(folder, toolchain);
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
        await this.swiftPackage.reload(this.toolchain);
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
        await this.swiftPackage.loadSwiftPlugins(this.toolchain, logger);
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
            this.testExplorer = new TestExplorer(this);
        }
        return this.testExplorer;
    }

    /** Create Test explorer for this folder */
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

    /** Return if package folder has a test explorer */
    hasTestExplorer() {
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
}

export interface EditedPackage {
    name: string;
    folder: string;
}
