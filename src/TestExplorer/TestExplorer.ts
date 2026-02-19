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

import { FolderContext } from "../FolderContext";
import { TargetType } from "../SwiftPackage";
import { FolderOperation, SwiftFileEvent, WorkspaceContext } from "../WorkspaceContext";
import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { buildOptions, getBuildAllTask } from "../tasks/SwiftTaskProvider";
import { TaskManager } from "../tasks/TaskManager";
import { SwiftExecOperation, TaskOperation } from "../tasks/TaskQueue";
import { getErrorDescription } from "../utilities/utilities";
import { Version } from "../utilities/version";
import { parseTestsFromDocumentSymbols } from "./DocumentSymbolTestDiscovery";
import { LSPTestDiscovery } from "./LSPTestDiscovery";
import { parseTestsFromSwiftTestListOutput } from "./SPMTestDiscovery";
import { TestCodeLensProvider } from "./TestCodeLensProvider";
import * as TestDiscovery from "./TestDiscovery";
import { TestRunProxy } from "./TestRunProxy";
import { TestRunner } from "./TestRunner";
import { flattenTestItemCollection } from "./TestUtils";

/** Build test explorer UI */
export class TestExplorer {
    static readonly errorTestItemId = "#Error#";
    public controller: vscode.TestController;
    public testRunProfiles: vscode.TestRunProfile[];

    private lspTestDiscovery: LSPTestDiscovery;
    private subscriptions: vscode.Disposable[];
    private tokenSource = new vscode.CancellationTokenSource();

    // Emits after the `vscode.TestController` has been updated.
    private onTestItemsDidChangeEmitter = new vscode.EventEmitter<vscode.TestController>();
    public onTestItemsDidChange: vscode.Event<vscode.TestController>;

    public onDidCreateTestRunEmitter = new vscode.EventEmitter<TestRunProxy>();
    public onCreateTestRun: vscode.Event<TestRunProxy>;

    private codeLensProvider: TestCodeLensProvider;

    constructor(
        public folderContext: FolderContext,
        private tasks: TaskManager,
        private logger: SwiftLogger,
        private onDidChangeSwiftFiles: (
            listener: (event: SwiftFileEvent) => void
        ) => vscode.Disposable
    ) {
        this.onTestItemsDidChange = this.onTestItemsDidChangeEmitter.event;
        this.onCreateTestRun = this.onDidCreateTestRunEmitter.event;

        this.lspTestDiscovery = this.configureLSPTestDiscovery(folderContext);
        this.codeLensProvider = new TestCodeLensProvider(this);
        this.controller = this.createController(folderContext);

        this.testRunProfiles = TestRunner.setupProfiles(
            this.controller,
            this.folderContext,
            this.onDidCreateTestRunEmitter
        );

        this.subscriptions = [
            this.tokenSource,
            this.controller,
            this.onTestItemsDidChangeEmitter,
            this.onDidCreateTestRunEmitter,
            this.codeLensProvider,
            ...this.testRunProfiles,
            this.onTestItemsDidChange(() => this.updateSwiftTestContext()),
            this.discoverUpdatedTestsAfterBuild(folderContext),
        ];
    }

    /**
     * Query the LSP for tests in the document. If the LSP is not available
     * this method will fallback to the legacy method of parsing document symbols,
     * but only for XCTests.
     * @param folder The folder context.
     * @param uri The document URI. If the document is not part of a test target, this method will do nothing.
     * @param symbols The document symbols.
     * @returns A promise that resolves when the tests have been retrieved.
     */
    public async getDocumentTests(
        folder: FolderContext,
        uri: vscode.Uri,
        symbols: vscode.DocumentSymbol[]
    ): Promise<void> {
        const target = await folder.swiftPackage.getTarget(uri.fsPath);
        if (target?.type !== "test") {
            this.logger.info(
                `Target ${target?.name ?? "undefined"} is not a test target, aborting looking for tests within it`,
                "Test Explorer"
            );
            return;
        }

        this.logger.info(`Getting tests for ${uri.toString()}`, "Test Explorer");
        try {
            const tests = await this.lspTestDiscovery.getDocumentTests(folder.swiftPackage, uri);
            this.logger.info(
                `LSP test discovery found ${tests.length} top level tests`,
                "Test Explorer"
            );
            TestDiscovery.updateTestsForTarget(
                this.controller,
                { id: target.c99name, label: target.name },
                tests,
                uri
            );
            this.logger.info(
                `Emitting test item change after LSP test discovery for ${uri.toString()}`,
                "Test Explorer"
            );
            this.onTestItemsDidChangeEmitter.fire(this.controller);
        } catch (error) {
            this.logger.error(
                `Error occurred during LSP test discovery for ${uri.toString()}: ${error}`,
                "Test Explorer"
            );
            // Fallback to parsing document symbols for XCTests only
            const tests = parseTestsFromDocumentSymbols(target.name, symbols, uri);
            this.logger.info(
                `Parsed ${tests.length} top level tests from document symbols from ${uri.toString()}`,
                "Test Explorer"
            );
            this.updateTests(this.controller, tests, uri);
        }
    }

    public dispose() {
        this.tokenSource.cancel();
        this.subscriptions.forEach(element => element.dispose());
        this.subscriptions = [];
    }

    /**
     * Creates an LSPTestDiscovery client for the given folder context.
     */
    private configureLSPTestDiscovery(folderContext: FolderContext): LSPTestDiscovery {
        return new LSPTestDiscovery(folderContext.languageClientManager);
    }

    /**
     * Creates a test controller for the given folder context.
     */
    private createController(folderContext: FolderContext) {
        const controller = vscode.tests.createTestController(
            folderContext.name,
            `${folderContext.name} Tests`
        );

        controller.resolveHandler = async item => {
            if (!item) {
                await this.discoverTestsInWorkspace(this.tokenSource.token);
            }
        };

        return controller;
    }

    /**
     * Configure test discovery for updated tests after a build task has completed.
     */
    private discoverUpdatedTestsAfterBuild(folderContext: FolderContext): vscode.Disposable {
        let testFileEdited = true;
        const endProcessDisposable = this.tasks.onDidEndTaskProcess(event => {
            const task = event.execution.task;
            const execution = task.execution as vscode.ProcessExecution;
            if (
                task.scope === folderContext.workspaceFolder &&
                task.group === vscode.TaskGroup.Build &&
                execution?.options?.cwd === folderContext.folder.fsPath &&
                event.exitCode === 0 &&
                task.definition.dontTriggerTestDiscovery !== true &&
                testFileEdited
            ) {
                testFileEdited = false;

                // only run discover tests if the library has tests
                void folderContext.swiftPackage.getTargets(TargetType.test).then(targets => {
                    if (targets.length > 0) {
                        void this.discoverTestsInWorkspace(this.tokenSource.token);
                    }
                });
            }
        });

        // add file watcher to catch changes to swift test files
        const didChangeSwiftFileDisposable = this.onDidChangeSwiftFiles(({ uri }) => {
            if (testFileEdited === false) {
                void folderContext.getTestTarget(uri).then(target => {
                    if (target) {
                        testFileEdited = true;
                    }
                });
            }
        });

        return vscode.Disposable.from(endProcessDisposable, didChangeSwiftFileDisposable);
    }

    /**
     * Create folder observer that creates a TestExplorer when a folder is added and
     * Discovers available tests when the folder is in focus
     * @param workspaceContext Workspace context for extension
     * @returns Observer disposable
     */
    public static observeFolders(workspaceContext: WorkspaceContext): vscode.Disposable {
        const tokenSource = new vscode.CancellationTokenSource();
        const disposable = workspaceContext.onDidChangeFolders(({ folder, operation }) => {
            switch (operation) {
                case FolderOperation.add:
                case FolderOperation.packageUpdated:
                    if (folder) {
                        void this.setupTestExplorerForFolder(folder, tokenSource.token);
                    }
                    break;
            }
        });
        return vscode.Disposable.from(tokenSource, disposable);
    }

    /**
     * Configures a test explorer for the given folder.
     * If the folder has test targets, and there is no existing test explorer,
     * it will create a test explorer and discover tests.
     * If the folder has no test targets, it will remove any existing test explorer.
     * If the folder has test targets and an existing test explorer, it will refresh the tests.
     */
    private static async setupTestExplorerForFolder(
        folder: FolderContext,
        token: vscode.CancellationToken
    ) {
        const targets = await folder.swiftPackage.getTargets(TargetType.test);
        const hasTestTargets = targets.length > 0;
        if (hasTestTargets && !folder.hasTestExplorer()) {
            const testExplorer = folder.addTestExplorer();
            if (
                configuration.folder(folder.workspaceFolder).disableAutoResolve &&
                process.platform === "win32" &&
                folder.swiftVersion.isLessThan(new Version(5, 10, 0))
            ) {
                // On Windows 5.9 and earlier discoverTestsInWorkspace kicks off a build,
                // which will perform a resolve.
                return;
            }
            await testExplorer.discoverTestsInWorkspace(token);
        } else if (hasTestTargets && folder.hasTestExplorer()) {
            await folder.refreshTestExplorer();
        } else if (!hasTestTargets && folder.hasTestExplorer()) {
            folder.removeTestExplorer();
        }
    }

    /**
     * Sets the `swift.tests` context variable which is used by commands
     * to determine if the test item belongs to the Swift extension.
     */
    private updateSwiftTestContext() {
        const items = flattenTestItemCollection(this.controller.items).map(({ id }) => id);
        void vscode.commands.executeCommand("setContext", "swift.tests", items).then(() => {
            /* Put in worker queue */
        });
    }

    private updateTests(
        controller: vscode.TestController,
        tests: TestDiscovery.TestClass[],
        uri?: vscode.Uri
    ) {
        this.logger.debug("Updating tests in test explorer", "Test Discovery");
        TestDiscovery.updateTests(controller, tests, uri);
        this.onTestItemsDidChangeEmitter.fire(controller);
    }

    /**
     * Discover tests
     */
    private async discoverTestsInWorkspace(token: vscode.CancellationToken) {
        try {
            // If the LSP cannot produce a list of tests it throws and
            // we fall back to discovering tests with SPM.
            await this.discoverTestsInWorkspaceLSP(token);
        } catch {
            this.logger.debug(
                "workspace/tests LSP request not supported, falling back to SPM to discover tests.",
                "Test Discovery"
            );
            await this.discoverTestsInWorkspaceSPM(token);
        }
    }

    /**
     * Discover tests
     * Uses `swift test --list-tests` to get the list of tests
     */
    private async discoverTestsInWorkspaceSPM(token: vscode.CancellationToken) {
        const runDiscover = async (explorer: TestExplorer, firstTry: boolean) => {
            try {
                if (firstTry && configuration.lsp.disable === true) {
                    this.warnSourceKitLSPDisabled();
                }
                const toolchain = explorer.folderContext.toolchain;

                // get build options before build is run so we can be sure they aren't changed
                // mid-build
                const testBuildOptions = buildOptions(toolchain);

                // normally we wouldn't run the build here, but you can suspend swiftPM on macOS
                // if you try and list tests while skipping the build if you are using a different
                // sanitizer settings
                if (process.platform === "darwin" && configuration.sanitizer !== "off") {
                    const task = await getBuildAllTask(explorer.folderContext);
                    task.definition.dontTriggerTestDiscovery = true;
                    const exitCode = await explorer.folderContext.taskQueue.queueOperation(
                        new TaskOperation(task)
                    );
                    if (exitCode === undefined || exitCode !== 0) {
                        explorer.setErrorTestItem("Build the project to enable test discovery.");
                        return;
                    }
                }

                if (token.isCancellationRequested) {
                    return;
                }

                // get list of tests from `swift test list --skip-build`
                let listTestArguments: string[] = ["test", "list", "--skip-build"];
                listTestArguments = [...listTestArguments, ...testBuildOptions];
                const listTestsOperation = new SwiftExecOperation(
                    listTestArguments,
                    explorer.folderContext,
                    "Listing Tests",
                    { showStatusItem: true, checkAlreadyRunning: false, log: "Listing tests" },
                    stdout => {
                        // if we got to this point we can get rid of any error test item
                        explorer.deleteErrorTestItem();

                        const tests = parseTestsFromSwiftTestListOutput(stdout);
                        this.logger.debug(
                            `Discovered ${tests.length} top level tests via 'swift test --list-tests', updating test explorer`,
                            "Test Discovery"
                        );
                        explorer.updateTests(explorer.controller, tests);
                    }
                );
                await explorer.folderContext.taskQueue.queueOperation(listTestsOperation, token);
            } catch (error) {
                // If a test list fails its possible the tests have not been built.
                // Build them and try again, and if we still fail then notify the user.
                if (firstTry) {
                    const backgroundTask = await getBuildAllTask(explorer.folderContext);
                    if (!backgroundTask) {
                        return;
                    }

                    try {
                        await explorer.folderContext.taskQueue.queueOperation(
                            new TaskOperation(backgroundTask)
                        );
                    } catch {
                        // can ignore if running task fails
                    }

                    // Retry test discovery after performing a build.
                    await runDiscover(explorer, false);
                } else {
                    this.handleDiscoveryError(explorer, error);
                }
            }
        };
        await runDiscover(this, true);
    }

    private warnSourceKitLSPDisabled() {
        const ok = "OK";
        const enable = "Enable SourceKit-LSP";
        void vscode.window
            .showInformationMessage(
                `swift-testing tests will not be detected since SourceKit-LSP
                            has been disabled for this workspace.`,
                enable,
                ok
            )
            .then(selected => {
                if (selected === enable) {
                    this.logger.info(`Enabling SourceKit-LSP after swift-testing message`);
                    void vscode.workspace
                        .getConfiguration("swift")
                        .update("sourcekit-lsp.disable", false)
                        .then(() => {
                            /* Put in worker queue */
                        });
                } else if (selected === ok) {
                    this.logger.info(`User acknowledged that SourceKit-LSP is disabled`);
                }
            });
    }

    private handleDiscoveryError(explorer: TestExplorer, error: unknown) {
        const errorDescription = getErrorDescription(error);
        if (this.isMissingBinaryError(errorDescription)) {
            explorer.setErrorTestItem("Build the project to enable test discovery.");
        } else if (errorDescription.startsWith("error: no tests found")) {
            explorer.setErrorTestItem("Add a test target to your Package.", "No Tests Found.");
        } else {
            explorer.setErrorTestItem(errorDescription);
        }
        this.logger.error(
            `Test Discovery Failed: ${errorDescription}`,
            explorer.folderContext.name
        );
    }

    private isMissingBinaryError(errorDescription: string): boolean {
        return (
            (process.platform === "darwin" && /error: unableToLoadBundle/.test(errorDescription)) ||
            (process.platform === "win32" && /The file doesn't exist./.test(errorDescription)) ||
            (!["darwin", "win32"].includes(process.platform) &&
                /No such file or directory/.test(errorDescription))
        );
    }

    /**
     * Discover tests
     */
    private async discoverTestsInWorkspaceLSP(token: vscode.CancellationToken) {
        this.logger.debug("Discovering tests in workspace via LSP", "Test Discovery");

        const tests = await this.lspTestDiscovery.getWorkspaceTests(
            this.folderContext.swiftPackage
        );

        if (token.isCancellationRequested) {
            this.logger.info("Test discovery cancelled", "Test Discovery");
            return;
        }

        this.logger.debug(
            `Discovered ${tests.length} top level tests, updating test explorer`,
            "Test Discovery"
        );

        await TestDiscovery.updateTestsFromClasses(
            this.controller,
            this.folderContext.swiftPackage,
            tests
        );

        this.logger.debug(
            "Emitting test item change after LSP workspace test discovery",
            "Test Discovery"
        );

        this.onTestItemsDidChangeEmitter.fire(this.controller);
    }

    /** Delete TestItem with error id */
    private deleteErrorTestItem() {
        this.controller.items.delete(TestExplorer.errorTestItemId);
        this.onTestItemsDidChangeEmitter.fire(this.controller);
    }

    /**
     * Add/replace a TestItem with an error, if test controller currently has no TestItems
     * @param errorDescription Error description to display
     */
    private setErrorTestItem(errorDescription: string | undefined, title = "Test Discovery Error") {
        this.logger.error(`Test Discovery Error: ${errorDescription}`);
        this.controller.items.forEach(item => {
            this.controller.items.delete(item.id);
        });
        if (this.controller.items.size === 0) {
            const errorItem = this.controller.createTestItem(TestExplorer.errorTestItemId, title);
            errorItem.error = errorDescription;
            this.controller.items.add(errorItem);
        }
        this.onTestItemsDidChangeEmitter.fire(this.controller);
    }
}
