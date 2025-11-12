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
import { createSwiftTask, getBuildAllTask } from "@src/tasks/SwiftTaskProvider";

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

    activateExtensionForSuite({
        async setup(api) {
            return await api.withWorkspaceContext(async ctx => {
                workspaceContext = ctx;
                folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
                buildAllTask = await getBuildAllTask(folderContext);
                return await updateSettings({
                    "swift.backgroundCompilation": true,
                });
            });
        },
    });

    suite("build all on save", () => {
        let subscriptions: vscode.Disposable[] = [];

        teardown(async () => {
            subscriptions.forEach(s => s.dispose());
            subscriptions = [];
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
            suiteSetup(async () => {
                nonSwiftTask = new vscode.Task(
                    {
                        type: "shell",
                        command: ["swift"],
                        args: ["build"],
                        group: {
                            id: "build",
                            isDefault: true,
                        },
                        label: "shell build",
                    },
                    folderContext.workspaceFolder,
                    "shell build",
                    "Workspace",
                    new vscode.ShellExecution("", {
                        cwd: testAssetUri("defaultPackage").fsPath,
                    })
                );
                swiftTask = createSwiftTask(
                    ["build"],
                    "swift build",
                    {
                        cwd: testAssetUri("defaultPackage"),
                        scope: folderContext.workspaceFolder,
                    },
                    folderContext.toolchain
                );
                swiftTask.source = "Workspace";
                // Restoring settings will be handled by the top level suite's setup() function.
                await updateSettings({
                    "swift.backgroundCompilation": {
                        enabled: true,
                        useDefaultTask: true,
                    },
                });
            });

            setup(() => {
                tasksMock.fetchTasks.withArgs().resolves([nonSwiftTask, swiftTask, buildAllTask]);
                backgroundConfiguration = new BackgroundCompilation(folderContext);
            });

            teardown(() => {
                backgroundConfiguration.dispose();
            });

            test("swift default task", async () => {
                swiftTask.group = { id: "build", isDefault: true };
                expect(await backgroundConfiguration.getTask()).to.equal(swiftTask);
            });

            test("non-swift default task", async () => {
                nonSwiftTask.group = { id: "build", isDefault: true };
                expect(await backgroundConfiguration.getTask()).to.equal(nonSwiftTask);
            });

            test("don't use default task", async () => {
                swiftTask.group = { id: "build", isDefault: true };
                await vscode.workspace.getConfiguration("swift").update("backgroundCompilation", {
                    enabled: true,
                    useDefaultTask: false,
                });
                expect(await backgroundConfiguration.getTask()).to.equal(buildAllTask);
            });
        });
    });
});
