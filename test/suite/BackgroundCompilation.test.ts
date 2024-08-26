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
import { WorkspaceContext } from "../../src/WorkspaceContext";
import { globalWorkspaceContextPromise } from "./extension.test";
import { testAssetUri } from "../fixtures";
import { waitForNoRunningTasks } from "../utilities";

suite("BackgroundCompilation Test Suite", () => {
    let workspaceContext: WorkspaceContext;

    suiteSetup(async () => {
        workspaceContext = await globalWorkspaceContextPromise;
        assert.notEqual(workspaceContext.folders.length, 0);
        await waitForNoRunningTasks();
        await vscode.workspace.getConfiguration("swift").update("backgroundCompilation", true);
    });

    suiteTeardown(async () => {
        await vscode.workspace.getConfiguration("swift").update("backgroundCompilation", undefined);
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    });

    test("build all on save @slow", async () => {
        const taskPromise = new Promise<void>(res => {
            vscode.tasks.onDidStartTask(e => {
                const task = e.execution.task;
                if (task.name.includes("Build All")) {
                    vscode.tasks.onDidEndTask(e => {
                        if (e.execution.task === task) {
                            res();
                        }
                    });
                }
            });
        });

        const uri = testAssetUri("defaultPackage/Sources/PackageExe/main.swift");
        await vscode.workspace
            .openTextDocument(uri.fsPath)
            .then(doc => vscode.window.showTextDocument(doc));
        await vscode.workspace.save(uri);

        await taskPromise;
    }).timeout(120000);
});
