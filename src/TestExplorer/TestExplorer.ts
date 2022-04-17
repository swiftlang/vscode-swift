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
import { execSwift, getErrorDescription, isPathInsidePath } from "../utilities/utilities";
import { FolderEvent, WorkspaceContext } from "../WorkspaceContext";
import { TestRunner } from "./TestRunner";
import { LSPTestDiscovery } from "./LSPTestDiscovery";
import { swiftpmSDKFlags } from "../SwiftTaskProvider";

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
            const execution = task.execution as vscode.ShellExecution;
            if (
                task.scope === this.folderContext.workspaceFolder &&
                task.group === vscode.TaskGroup.Build &&
                execution?.options?.cwd === this.folderContext.folder.fsPath &&
                event.exitCode === 0
            ) {
                this.discoverTestsInWorkspace();
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
                    folder?.addTestExplorer();
                    folder?.testExplorer?.discoverTestsInWorkspace();
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
            // get list of tests from `swift test --list-tests`
            const { stdout } = await execSwift(
                ["test", "--skip-build", "--list-tests", ...swiftpmSDKFlags()],
                {
                    cwd: this.folderContext.folder.fsPath,
                },
                this.folderContext
            );

            // if we got to this point we can get rid of any error test item
            this.deleteErrorTestItem();

            // extract tests from `swift test --list-tests` output
            const results = stdout.match(/^.*\.[a-zA-Z0-9_]*\/[a-zA-Z0-9_]*$/gm);
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
                const groups = /^([\w\d_]*)\.([\w\d_]*)\/([\w\d_]*)/.exec(result);
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
                const item = this.controller.createTestItem(result, groups[3]);
                classItem.children.add(item);
            }

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
    private setErrorTestItem(errorDescription: string, title = "Test Discovery Error") {
        this.deleteErrorTestItem();
        if (this.controller.items.size === 0) {
            const errorItem = this.controller.createTestItem(TestExplorer.errorTestItemId, title);
            errorItem.error = errorDescription;
            this.controller.items.add(errorItem);
        }
    }
}
