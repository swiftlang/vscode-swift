//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { expect } from "chai";
import * as vscode from "vscode";

import { BackgroundCompilation } from "@src/BackgroundCompilation";
import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { getBuildAllTask } from "@src/tasks/SwiftTaskProvider";

import { mockGlobalObject } from "../MockUtils";
import { testAssetUri } from "../fixtures";
import { tag } from "../tags";
import { closeAllEditors } from "../utilities/commands";
import { waitForNoRunningTasks } from "../utilities/tasks";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "./utilities/testutilities";

tag("large").suite("BackgroundCompilation Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;
    let buildAllTask: vscode.Task;

    async function setupFolder(ctx: WorkspaceContext) {
        workspaceContext = ctx;
        folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
        buildAllTask = await getBuildAllTask(folderContext);
    }

    suite("build all on save", () => {
        let subscriptions: vscode.Disposable[];

        activateExtensionForSuite({
            async setup(ctx) {
                subscriptions = [];
                await setupFolder(ctx);
                return await updateSettings({
                    "swift.backgroundCompilation": true,
                });
            },
        });

        suiteTeardown(async () => {
            subscriptions.forEach(s => s.dispose());
            await closeAllEditors();
        });

        test("runs build task", async () => {
            const taskStartPromise = new Promise<void>(resolve => {
                subscriptions.push(
                    vscode.tasks.onDidStartTask(e => {
                        const task = e.execution.task;
                        if (task.name.includes("Build All")) {
                            resolve();
                        }
                    })
                );
            });

            const uri = testAssetUri("defaultPackage/Sources/PackageExe/main.swift");
            const doc = await vscode.workspace.openTextDocument(uri.fsPath);
            await vscode.window.showTextDocument(doc);
            await vscode.workspace.save(uri);

            await taskStartPromise;
            await waitForNoRunningTasks();
        });
    });

    suite("getTask", () => {
        const tasksMock = mockGlobalObject(vscode, "tasks");
        let swiftTask: vscode.Task;
        let nonSwiftTask: vscode.Task;
        let backgroundConfiguration: BackgroundCompilation;

        suite("useDefaultTask", () => {
            activateExtensionForSuite({
                async setup(ctx) {
                    await setupFolder(ctx);
                    nonSwiftTask = new vscode.Task(
                        {
                            type: "shell",
                            args: ["./build.sh"],
                            cwd: "defaultPackage",
                            group: {
                                id: "build",
                                isDefault: true,
                            },
                            label: "Default build",
                        },
                        folderContext.workspaceFolder,
                        "Default build",
                        "shell"
                    );
                    nonSwiftTask.group = { id: "build", isDefault: true };
                    swiftTask = new vscode.Task(
                        {
                            type: "swift",
                            args: ["build"],
                            cwd: "defaultPackage",
                            label: "swift build",
                        },
                        folderContext.workspaceFolder,
                        "Swift build",
                        "swift"
                    );
                    swiftTask.group = { id: "build", isDefault: true };
                    return await updateSettings({
                        "swift.backgroundCompilation": {
                            enabled: true,
                            useDefaultTask: true,
                        },
                    });
                },
            });

            setup(() => {
                tasksMock.fetchTasks.resolves([swiftTask, buildAllTask]);
                backgroundConfiguration = new BackgroundCompilation(folderContext);
            });

            teardown(() => {
                backgroundConfiguration.dispose();
            });

            test("swift default task", async () => {
                expect(await backgroundConfiguration.getTask()).to.equal(swiftTask);
            });

            test("don't use default task", async () => {
                await vscode.workspace.getConfiguration("swift").update("backgroundCompilation", {
                    enabled: true,
                    useDefaultTask: false,
                });
                expect(await backgroundConfiguration.getTask()).to.equal(buildAllTask);
            });

            test("non-swift default task", async () => {
                tasksMock.fetchTasks.resolves([nonSwiftTask, swiftTask, buildAllTask]);
                swiftTask.group = { id: "build", isDefault: false };
                expect(await backgroundConfiguration.getTask()).to.equal(buildAllTask);
            });
        });
    });
});
