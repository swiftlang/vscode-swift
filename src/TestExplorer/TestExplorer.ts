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
import { execSwift } from "../utilities/utilities";
import { FolderEvent, WorkspaceContext } from "../WorkspaceContext";

/** Build test explorer UI */
export class TestExplorer {
    public controller: vscode.TestController;
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

        // add end of task handler to be called whenever a build task has finished. If
        // it is the build task for this folder then update the tests
        const onDidEndTask = vscode.tasks.onDidEndTaskProcess(event => {
            const task = event.execution.task;
            const execution = task.execution as vscode.ShellExecution;
            if (
                task.scope === this.folderContext.workspaceFolder &&
                task.group === vscode.TaskGroup.Build &&
                execution?.options?.cwd === this.folderContext.folder.fsPath
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
        return workspaceContext.observeFolders((folder, event) => {
            switch (event) {
                case FolderEvent.add:
                    folder?.addTestExplorer();
                    break;

                case FolderEvent.focus:
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
                        if (!results.find(item => item === testName)) {
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
                // match <testTarget>.<class>/<function> from line
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
        } catch (error) {
            // ignore errors
            console.log(error);
        }
    }
}
