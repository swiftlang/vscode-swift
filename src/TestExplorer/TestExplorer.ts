//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
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
import { execSwift, isPathInsidePath } from "../utilities/utilities";
import { FolderEvent, WorkspaceContext } from "../WorkspaceContext";
import { TestRunner } from "./TestRunner";
import { LSPTestDiscovery } from "./LSPTestDiscovery";

/** Build test explorer UI */
export class TestExplorer {
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
        const onDidEndTask = vscode.tasks.onDidEndTaskProcess(event => {
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

        const onDidSaveDocument = vscode.workspace.onDidSaveTextDocument(event => {
            this.lspFunctionParser?.onDidSave(event.uri);
        });
        const onDidChangeActiveWindow = vscode.window.onDidChangeActiveTextEditor(async editor => {
            const uri = editor?.document?.uri;
            if (!uri || this.lspFunctionParser?.uri === uri) {
                return;
            }
            if (isPathInsidePath(uri.fsPath, this.folderContext.folder.fsPath)) {
                this.lspFunctionParser = new LSPTestDiscovery(
                    uri,
                    this.folderContext,
                    this.controller
                );
                await this.lspFunctionParser.setActive();
            }
        });

        this.subscriptions = [
            onDidSaveDocument,
            onDidChangeActiveWindow,
            onDidEndTask,
            this.controller,
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
        return workspaceContext.observeFolders((folder, event) => {
            switch (event) {
                case FolderEvent.add:
                    folder?.addTestExplorer();
                    folder?.testExplorer?.discoverTestsInWorkspace();
                    break;
            }
        });
    }

    /**
     * Discover tests
     * Uses `swift test --list-tests` to get the list of tests
     */
    async discoverTestsInWorkspace() {
        try {
            const { stdout } = await execSwift(["test", "--skip-build", "--list-tests"], {
                cwd: this.folderContext.folder.fsPath,
            });
            const uri = vscode.window.activeTextEditor?.document.uri;
            if (uri) {
                this.lspFunctionParser = new LSPTestDiscovery(
                    uri,
                    this.folderContext,
                    this.controller
                );
                await this.lspFunctionParser.setActive();
            }
            // get list of tests
            const results = stdout.match(/^.*\.[a-zA-Z0-9_]*\/[a-zA-Z0-9_]*$/gm);
            if (!results) {
                return;
            }

            // remove item that aren't in result list
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
            this.folderContext.workspaceContext.outputChannel.error(
                error,
                "Test Discovery Failed",
                this.folderContext.name
            );
        }
    }
}
