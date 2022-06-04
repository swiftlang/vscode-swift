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
import * as assert from "assert";
import { testAssetUri, testAssetWorkspaceFolder } from "../fixtures";
import { FolderEvent, WorkspaceContext } from "../../src/WorkspaceContext";
import { createBuildAllTask, platformDebugBuildOptions } from "../../src/SwiftTaskProvider";

suite("WorkspaceContext Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    const subscriptions: { dispose(): unknown }[] = [];
    const packageFolder: vscode.WorkspaceFolder = testAssetWorkspaceFolder("package1");

    suiteSetup(async () => {
        workspaceContext = await WorkspaceContext.create();
        await workspaceContext.addWorkspaceFolder(packageFolder);
        subscriptions.push(workspaceContext);
    });

    suiteTeardown(async () => {
        workspaceContext?.removeFolder(packageFolder);
        subscriptions.forEach(sub => sub.dispose());
    });

    suite("Folder Events", () => {
        test("Add/Remove", async () => {
            assert.strictEqual(workspaceContext.folders.length, 1);
            let count = 0;
            const observer = workspaceContext?.observeFolders((folder, operation) => {
                assert(folder !== null);
                assert.strictEqual(folder.swiftPackage.name, "package2");
                switch (operation) {
                    case FolderEvent.add:
                        count++;
                        break;
                    case FolderEvent.remove:
                        count--;
                        break;
                }
            });
            const packageFolder = testAssetWorkspaceFolder("package2");
            await workspaceContext?.addWorkspaceFolder(packageFolder);
            assert.strictEqual(count, 1);
            await workspaceContext?.removeFolder(packageFolder);
            assert.strictEqual(count, 0);
            observer?.dispose();
        }).timeout(5000);
    });

    suite("Tasks", async () => {
        const swiftConfig = vscode.workspace.getConfiguration("swift");

        suiteTeardown(async () => {
            await swiftConfig.update("buildArguments", undefined);
            await swiftConfig.update("path", undefined);
        });

        test("Default Task values", async () => {
            const folder = workspaceContext.folders.find(f => f.workspaceFolder === packageFolder);
            assert(folder);
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution as vscode.ShellExecution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "Build All");
            assert.notStrictEqual(execution?.args, [
                "build",
                "--build-tests",
                ...platformDebugBuildOptions(),
            ]);
            assert.strictEqual(buildAllTask.scope, packageFolder);
        });

        test("Build Settings", async () => {
            const folder = workspaceContext.folders.find(f => f.workspaceFolder === packageFolder);
            assert(folder);
            await swiftConfig.update("buildArguments", ["--sanitize=thread"]);
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution as vscode.ShellExecution;
            assert.notStrictEqual(execution?.args, [
                "build",
                "--build-tests",
                ...platformDebugBuildOptions(),
                "--sanitize=thread",
            ]);
        });

        test("Swift Path", async () => {
            const folder = workspaceContext.folders.find(f => f.workspaceFolder === packageFolder);
            assert(folder);
            await swiftConfig.update("path", "/usr/bin/swift");
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution as vscode.ShellExecution;
            assert.notStrictEqual(execution?.command, "/usr/bin/swift");
        });
    });

    suite("Language Server", async () => {
        test("Server Start", async () => {
            await workspaceContext.focusFolder(workspaceContext.folders[0]);
            const lspWorkspaceFolder = workspaceContext.languageClientManager.workspaceFolder;
            assert.notStrictEqual(lspWorkspaceFolder, testAssetUri("package1"));
        });
    });
}).timeout(5000);
