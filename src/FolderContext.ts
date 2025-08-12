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
import { FolderOperation } from "./WorkspaceContext";
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
     * Constructs a new instance of the FolderContext class.
     *
     * @param folder - The URI of the folder associated with this context.
     * @param toolchain - The Swift toolchain used for building and running Swift code.
     * @param linuxMain - The LinuxMain configuration for the Swift package.
     * @param swiftPackage - The Swift package information for this context.
     * @param workspaceFolder - The VS Code workspace folder associated with this context.
     * @param logger - The logger instance for logging operations and events.
     * @param _fireEvent - A callback function to fire events related to folder operations.
     *
     * Initializes the package watcher, background compilation, task queue, and test run manager for the folder context.
     */
    constructor(
        public folder: vscode.Uri,
        public toolchain: SwiftToolchain,
        public linuxMain: LinuxMain,
        public swiftPackage: SwiftPackage,
        public workspaceFolder: vscode.WorkspaceFolder,
        logger: SwiftLogger,
        private _fireEvent: (folder: FolderContext, event: FolderOperation) => Promise<void>
    ) {
        this.packageWatcher = new PackageWatcher(this, logger);
        this.backgroundCompilation = new BackgroundCompilation(this);
        this.taskQueue = new TaskQueue(this);
        this.testRunManager = new TestRunManager();
    }

    /**
     * Install watchers on the folder.
     */
    public async installWatchers() {
        await this.packageWatcher.install();
    }

    /** dispose of any thing FolderContext holds */
    dispose() {
        this.linuxMain?.dispose();
        this.packageWatcher.dispose();
        this.testExplorer?.dispose();
        this.backgroundCompilation.dispose();
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
        await this._fireEvent(this, event);
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
