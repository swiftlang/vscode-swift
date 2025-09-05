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
import * as assert from "assert";
import * as vscode from "vscode";

import { WorkspaceContext } from "@src/WorkspaceContext";

import { testAssetUri } from "../fixtures";
import { tag } from "../tags";
import { closeAllEditors } from "../utilities/commands";
import { waitForNoRunningTasks } from "../utilities/tasks";
import { activateExtensionForTest, updateSettings } from "./utilities/testutilities";

tag("large").suite("BackgroundCompilation Test Suite", () => {
    let subscriptions: vscode.Disposable[];
    let workspaceContext: WorkspaceContext;

    activateExtensionForTest({
        async setup(ctx) {
            subscriptions = [];
            workspaceContext = ctx;
            assert.notEqual(workspaceContext.folders.length, 0);
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
});
