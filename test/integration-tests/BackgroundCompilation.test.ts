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
import { match } from "sinon";
import * as vscode from "vscode";

import { BackgroundCompilation } from "@src/BackgroundCompilation";
import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import configuration from "@src/configuration";
import { getBuildAllTask } from "@src/tasks/SwiftTaskProvider";

import { mockGlobalObject, mockGlobalValue } from "../MockUtils";
import { testAssetUri } from "../fixtures";
import { tag } from "../tags";
import { closeAllEditors } from "../utilities/commands";
import { waitForNoRunningTasks } from "../utilities/tasks";
import {
    activateExtensionForTest,
    folderInRootWorkspace,
    updateSettings,
} from "./utilities/testutilities";

tag("large").suite("BackgroundCompilation Test Suite", () => {
    let subscriptions: vscode.Disposable[];
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;
    let buildAllTask: vscode.Task;

    activateExtensionForTest({
        async setup(ctx) {
            subscriptions = [];
            workspaceContext = ctx;
            folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
            buildAllTask = await getBuildAllTask(folderContext);
            return await updateSettings({
                "swift.backgroundCompilation": true,
            });
        },
    });

    suiteTeardown(async () => {
        subscriptions.forEach(s => s.dispose());
        await closeAllEditors();
    });

    test("build all on save", async () => {
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

    suite("getTask", () => {
        const tasksMock = mockGlobalObject(vscode, "tasks");
        let swiftTask: vscode.Task;
        let nonSwiftTask: vscode.Task;
        let backgroundConfiguration: BackgroundCompilation;
        const useDefaultTaskConfig = mockGlobalValue(configuration, "useDefaultTask");

        setup(async () => {
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
            swiftTask = new vscode.Task(
                {
                    type: "swift",
                    args: ["build"],
                    cwd: "defaultPackage",
                    group: "build",
                    label: "swift build",
                },
                folderContext.workspaceFolder,
                "Swift build",
                "swift"
            );
            backgroundConfiguration = new BackgroundCompilation(folderContext);
            tasksMock.fetchTasks.resolves([nonSwiftTask, swiftTask, buildAllTask]);
            tasksMock.fetchTasks.withArgs(match.object).resolves([swiftTask, buildAllTask]);
            useDefaultTaskConfig.setValue(true);
        });

        teardown(() => {
            backgroundConfiguration.dispose();
        });

        test("non-swift default task", async () => {
            expect(await backgroundConfiguration.getTask()).to.equal(buildAllTask);
        });

        test("swift default task", async () => {
            swiftTask.group = { id: "build", isDefault: true };
            expect(await backgroundConfiguration.getTask()).to.equal(swiftTask);
        });

        test("don't use default task", async () => {
            useDefaultTaskConfig.setValue(false);
            swiftTask.group = { id: "build", isDefault: true };
            expect(await backgroundConfiguration.getTask()).to.equal(buildAllTask);
        });
    });
});
