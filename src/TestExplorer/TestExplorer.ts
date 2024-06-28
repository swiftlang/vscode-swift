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
import { getErrorDescription, isPathInsidePath } from "../utilities/utilities";
import { FolderEvent, WorkspaceContext } from "../WorkspaceContext";
import { TestRunProxy, TestRunner } from "./TestRunner";
import { LSPTestDiscovery } from "./LSPTestDiscovery";
import { Version } from "../utilities/version";
import configuration from "../configuration";
import { buildOptions, getBuildAllTask } from "../tasks/SwiftTaskProvider";
import { SwiftExecOperation, TaskOperation } from "../tasks/TaskQueue";
import * as TestDiscovery from "./TestDiscovery";
import { TargetType } from "../SwiftPackage";
import { parseTestsFromSwiftTestListOutput } from "./SPMTestDiscovery";
import { parseTestsFromDocumentSymbols } from "./DocumentSymbolTestDiscovery";

/** Build test explorer UI */
export class TestExplorer {
    static errorTestItemId = "#Error#";
    public controller: vscode.TestController;
    public testRunProfiles: vscode.TestRunProfile[];
    private lspTestDiscovery: LSPTestDiscovery;
    private subscriptions: { dispose(): unknown }[];
    private testFileEdited = true;

    // Emits after the `vscode.TestController` has been updated.
    private onTestItemsDidChangeEmitter = new vscode.EventEmitter<vscode.TestController>();
    public onTestItemsDidChange: vscode.Event<vscode.TestController>;

    private onDidCreateTestRunEmitter = new vscode.EventEmitter<TestRunProxy>();
    public onCreateTestRun: vscode.Event<TestRunProxy>;

    constructor(public folderContext: FolderContext) {
        this.onTestItemsDidChange = this.onTestItemsDidChangeEmitter.event;
        this.onCreateTestRun = this.onDidCreateTestRunEmitter.event;

        this.controller = vscode.tests.createTestController(
            folderContext.name,
            `${folderContext.name} Tests`
        );

        this.controller.resolveHandler = async item => {
            if (!item) {
                await this.discoverTestsInWorkspace();
            } else {
                //
            }
        };

        this.testRunProfiles = TestRunner.setupProfiles(
            this.controller,
            this.folderContext,
            this.onDidCreateTestRunEmitter
        );

        this.lspTestDiscovery = new LSPTestDiscovery(
            folderContext.workspaceContext.languageClientManager
        );

        // add end of task handler to be called whenever a build task has finished. If
        // it is the build task for this folder then update the tests
        const onDidEndTask = folderContext.workspaceContext.tasks.onDidEndTaskProcess(event => {
            const task = event.execution.task;
            const execution = task.execution as vscode.ProcessExecution;
            if (
                task.scope === this.folderContext.workspaceFolder &&
                task.group === vscode.TaskGroup.Build &&
                execution?.options?.cwd === this.folderContext.folder.fsPath &&
                event.exitCode === 0 &&
                task.definition.dontTriggerTestDiscovery !== true &&
                this.testFileEdited
            ) {
                this.testFileEdited = false;
                // only run discover tests if the library has tests
                if (this.folderContext.swiftPackage.getTargets(TargetType.test).length > 0) {
                    this.discoverTestsInWorkspace();
                }
            }
        });

        // add file watcher to catch changes to swift test files
        const fileWatcher = this.folderContext.workspaceContext.observeSwiftFiles(uri => {
            if (this.testFileEdited === false && this.folderContext.getTestTarget(uri)) {
                this.testFileEdited = true;
            }
        });

        this.subscriptions = [
            fileWatcher,
            onDidEndTask,
            this.controller,
            this.onTestItemsDidChangeEmitter,
            this.onDidCreateTestRunEmitter,
            ...this.testRunProfiles,
        ];
    }

    dispose() {
        this.subscriptions.forEach(element => element.dispose());
    }

    /**
     * Create folder observer that creates a TestExplorer when a folder is added and
     * Discovers available tests when the folder is in focus
     * @param workspaceContext Workspace context for extension
     * @returns Observer disposable
     */
    static observeFolders(workspaceContext: WorkspaceContext): vscode.Disposable {
        return workspaceContext.observeFolders((folder, event, workspace) => {
            switch (event) {
                case FolderEvent.add:
                    if (folder) {
                        if (folder.swiftPackage.getTargets(TargetType.test).length > 0) {
                            folder.addTestExplorer();
                            // discover tests in workspace but only if disableAutoResolve is not on.
                            // discover tests will kick off a resolve if required
                            if (!configuration.folder(folder.workspaceFolder).disableAutoResolve) {
                                folder.testExplorer?.discoverTestsInWorkspace();
                            }
                        }
                    }
                    break;
                case FolderEvent.packageUpdated:
                    if (folder) {
                        const hasTestTargets =
                            folder.swiftPackage.getTargets(TargetType.test).length > 0;
                        if (hasTestTargets && !folder.hasTestExplorer()) {
                            folder.addTestExplorer();
                            // discover tests in workspace but only if disableAutoResolve is not on.
                            // discover tests will kick off a resolve if required
                            if (!configuration.folder(folder.workspaceFolder).disableAutoResolve) {
                                folder.testExplorer?.discoverTestsInWorkspace();
                            }
                        } else if (!hasTestTargets && folder.hasTestExplorer()) {
                            folder.removeTestExplorer();
                        }
                    }
                    break;
                case FolderEvent.focus:
                    if (folder) {
                        workspace.languageClientManager.documentSymbolWatcher = (
                            document,
                            symbols
                        ) => TestExplorer.onDocumentSymbols(folder, document, symbols);
                    }
            }
        });
    }

    /** Called whenever we have new document symbols */
    private static onDocumentSymbols(
        folder: FolderContext,
        document: vscode.TextDocument,
        symbols: vscode.DocumentSymbol[] | null | undefined
    ) {
        const uri = document?.uri;
        const testExplorer = folder?.testExplorer;
        if (testExplorer && symbols && uri && uri.scheme === "file") {
            if (isPathInsidePath(uri.fsPath, folder.folder.fsPath)) {
                const target = folder.swiftPackage.getTarget(uri.fsPath);
                if (target && target.type === "test") {
                    testExplorer.lspTestDiscovery
                        .getDocumentTests(folder.swiftPackage, uri)
                        .then(
                            tests =>
                                [
                                    {
                                        id: target.c99name,
                                        label: target.name,
                                        children: tests,
                                        location: undefined,
                                        disabled: false,
                                        style: "test-target",
                                        tags: [],
                                    },
                                ] as TestDiscovery.TestClass[]
                        )
                        // Fallback to parsing document symbols for XCTests only
                        .catch(() => parseTestsFromDocumentSymbols(target.name, symbols, uri))
                        .then(tests => {
                            testExplorer.updateTests(testExplorer.controller, tests, uri);
                        });
                }
            }
        }
    }

    private updateTests(
        controller: vscode.TestController,
        tests: TestDiscovery.TestClass[],
        uri?: vscode.Uri
    ) {
        TestDiscovery.updateTests(controller, tests, uri);
        this.onTestItemsDidChangeEmitter.fire(controller);
    }

    /**
     * Discover tests
     */
    async discoverTestsInWorkspace() {
        try {
            // If the LSP cannot produce a list of tests it throws and
            // we fall back to discovering tests with SPM.
            await this.discoverTestsInWorkspaceLSP();
        } catch {
            this.folderContext.workspaceContext.outputChannel.logDiagnostic(
                "workspace/tests LSP request not supported, falling back to SPM to discover tests.",
                "Test Discovery"
            );
            await this.discoverTestsInWorkspaceSPM();
        }
    }

    /**
     * Discover tests
     * Uses `swift test --list-tests` to get the list of tests
     */
    async discoverTestsInWorkspaceSPM() {
        async function runDiscover(explorer: TestExplorer, firstTry: boolean) {
            try {
                const toolchain = explorer.folderContext.workspaceContext.toolchain;
                // get build options before build is run so we can be sure they aren't changed
                // mid-build
                const testBuildOptions = buildOptions(toolchain);
                // normally we wouldn't run the build here, but you can hang swiftPM on macOS
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
                // get list of tests from `swift test --list-tests`
                let listTestArguments: string[];
                if (toolchain.swiftVersion.isGreaterThanOrEqual(new Version(5, 8, 0))) {
                    listTestArguments = ["test", "list", "--skip-build"];
                } else {
                    listTestArguments = ["test", "--list-tests", "--skip-build"];
                }
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
                        explorer.updateTests(explorer.controller, tests);
                    }
                );
                await explorer.folderContext.taskQueue.queueOperation(listTestsOperation);
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
                    const errorDescription = getErrorDescription(error);
                    if (
                        (process.platform === "darwin" &&
                            errorDescription.match(/error: unableToLoadBundle/)) ||
                        (process.platform === "win32" &&
                            errorDescription.match(/The file doesn’t exist./)) ||
                        (!["darwin", "win32"].includes(process.platform) &&
                            errorDescription.match(/No such file or directory/))
                    ) {
                        explorer.setErrorTestItem("Build the project to enable test discovery.");
                    } else if (errorDescription.startsWith("error: no tests found")) {
                        explorer.setErrorTestItem(
                            "Add a test target to your Package.",
                            "No Tests Found."
                        );
                    } else {
                        explorer.setErrorTestItem(errorDescription);
                    }
                    explorer.folderContext.workspaceContext.outputChannel.log(
                        `Test Discovery Failed: ${errorDescription}`,
                        explorer.folderContext.name
                    );
                }
            }
        }
        await runDiscover(this, true);
    }

    /**
     * Discover tests
     */
    async discoverTestsInWorkspaceLSP() {
        const tests = await this.lspTestDiscovery.getWorkspaceTests(
            this.folderContext.swiftPackage
        );
        TestDiscovery.updateTestsFromClasses(
            this.controller,
            this.folderContext.swiftPackage,
            tests
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
