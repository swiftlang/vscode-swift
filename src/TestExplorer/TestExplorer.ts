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
import { FolderContext } from "../FolderContext";
import { getErrorDescription, isPathInsidePath } from "../utilities/utilities";
import { FolderEvent, WorkspaceContext } from "../WorkspaceContext";
import { TestRunner } from "./TestRunner";
import { LSPTestDiscovery } from "./LSPTestDiscovery";
import { Version } from "../utilities/version";
import configuration from "../configuration";
import { buildOptions, getBuildAllTask } from "../SwiftTaskProvider";
import { SwiftExecOperation, TaskOperation } from "../TaskQueue";

/** Build test explorer UI */
export class TestExplorer {
    static errorTestItemId = "#Error#";
    public controller: vscode.TestController;
    private lspFunctionParser?: LSPTestDiscovery;
    private subscriptions: { dispose(): unknown }[];

    constructor(public folderContext: FolderContext) {
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

        TestRunner.setupProfiles(this.controller, this.folderContext);

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
                task.definition.dontTriggerTestDiscovery !== true
            ) {
                // only run discover tests if the library has tests
                if (this.folderContext.swiftPackage.getTargets("test").length > 0) {
                    this.discoverTestsInWorkspace();
                }
            }
        });

        this.subscriptions = [onDidEndTask, this.controller];
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
                        if (folder.swiftPackage.getTargets("test").length > 0) {
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
                        const testTargets = folder.swiftPackage.getTargets("test");
                        if (testTargets.length > 0 && !folder.hasTestExplorer()) {
                            folder.addTestExplorer();
                            // discover tests in workspace but only if disableAutoResolve is not on.
                            // discover tests will kick off a resolve if required
                            if (!configuration.folder(folder.workspaceFolder).disableAutoResolve) {
                                folder.testExplorer?.discoverTestsInWorkspace();
                            }
                        } else if (testTargets.length === 0 && folder.hasTestExplorer()) {
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
                if (testExplorer.lspFunctionParser?.uri === uri) {
                    testExplorer.lspFunctionParser.updateTestItems(symbols);
                } else {
                    testExplorer.lspFunctionParser = new LSPTestDiscovery(
                        uri,
                        folder,
                        testExplorer.controller
                    );
                    testExplorer.lspFunctionParser.updateTestItems(symbols);
                }
            }
        }
    }

    /**
     * Discover tests
     * Uses `swift test --list-tests` to get the list of tests
     */
    async discoverTestsInWorkspace() {
        try {
            const toolchain = this.folderContext.workspaceContext.toolchain;
            // get build options before build is run so we can be sure they aren't changed
            // mid-build
            const testBuildOptions = buildOptions(toolchain);
            // normally we wouldn't run the build here, but you can hang swiftPM on macOS
            // if you try and list tests while skipping the build if you are using a different
            // sanitizer settings
            if (process.platform === "darwin" && configuration.sanitizer !== "off") {
                const task = await getBuildAllTask(this.folderContext);
                task.definition.dontTriggerTestDiscovery = true;
                const exitCode = await this.folderContext.taskQueue.queueOperation(
                    new TaskOperation(task)
                );
                if (exitCode === undefined || exitCode !== 0) {
                    this.setErrorTestItem("Build the project to enable test discovery.");
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
                this.folderContext,
                "Listing Tests",
                { showStatusItem: true, checkAlreadyRunning: false, log: "Listing tests" },
                stdout => {
                    // if we got to this point we can get rid of any error test item
                    this.deleteErrorTestItem();

                    // extract tests from `swift test --list-tests` output
                    const results = stdout.match(/^.*\.[a-zA-Z0-9_]*\/.*$/gm);
                    if (!results) {
                        return;
                    }

                    // remove TestItems that aren't in either the swift test output or the LSP symbol list
                    this.controller.items.forEach(targetItem => {
                        targetItem.children.forEach(classItem => {
                            classItem.children.forEach(funcItem => {
                                const testName = `${targetItem.label}.${classItem.label}/${funcItem.label}`;
                                if (
                                    !results.find(item => item === testName) &&
                                    !this.lspFunctionParser?.includesFunction(
                                        targetItem.label,
                                        classItem.label,
                                        funcItem.label
                                    )
                                ) {
                                    classItem.children.delete(funcItem.id);
                                }
                            });
                            // delete class if it is empty
                            if (classItem.children.size === 0) {
                                targetItem.children.delete(classItem.id);
                            }
                        });
                    });

                    for (const result of results) {
                        // Regex "<testTarget>.<class>/<function>"
                        const groups = /^([\w\d_]*)\.([\w\d_]*)\/(.*)$/.exec(result);
                        if (!groups) {
                            continue;
                        }
                        let targetItem = this.controller.items.get(groups[1]);
                        if (!targetItem) {
                            targetItem = this.controller.createTestItem(groups[1], groups[1]);
                            this.controller.items.add(targetItem);
                        }
                        let classItem = targetItem.children.get(`${groups[1]}.${groups[2]}`);
                        if (!classItem) {
                            classItem = this.controller.createTestItem(
                                `${groups[1]}.${groups[2]}`,
                                groups[2]
                            );
                            targetItem.children.add(classItem);
                        }
                        if (!classItem.children.get(result)) {
                            const item = this.controller.createTestItem(result, groups[3]);
                            classItem.children.add(item);
                        }
                    }
                }
            );
            await this.folderContext.taskQueue.queueOperation(listTestsOperation);

            // add items to target test item as the setActive call above may not have done this
            // because the test target item did not exist when it was called
            this.lspFunctionParser?.addTestItems();
        } catch (error) {
            const errorDescription = getErrorDescription(error);
            if (
                (process.platform === "darwin" &&
                    errorDescription.match(/error: unableToLoadBundle/)) ||
                (process.platform === "win32" &&
                    errorDescription.match(/The file doesn’t exist./)) ||
                (!["darwin", "win32"].includes(process.platform) &&
                    errorDescription.match(/No such file or directory/))
            ) {
                this.setErrorTestItem("Build the project to enable test discovery.");
            } else if (errorDescription.startsWith("error: no tests found")) {
                this.setErrorTestItem("Add a test target to your Package.", "No Tests Found.");
            } else {
                this.setErrorTestItem(errorDescription);
            }
            this.folderContext.workspaceContext.outputChannel.log(
                `Test Discovery Failed: ${errorDescription}`,
                this.folderContext.name
            );
        }
    }

    /** Delete TestItem with error id */
    private deleteErrorTestItem() {
        this.controller.items.delete(TestExplorer.errorTestItemId);
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
    }
}
