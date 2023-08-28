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
import { testAssetUri } from "../fixtures";
import { FolderEvent, WorkspaceContext } from "../../src/WorkspaceContext";
import { createBuildAllTask, platformDebugBuildOptions } from "../../src/SwiftTaskProvider";
import { globalWorkspaceContextPromise } from "./extension.test";

suite("WorkspaceContext Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    const packageFolder: vscode.Uri = testAssetUri("defaultPackage");

    suiteSetup(async () => {
        workspaceContext = await globalWorkspaceContextPromise;
    });

    suite("Folder Events", () => {
        test("Add/Remove", async () => {
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
            const package2Folder = testAssetUri("package2");
            const workspaceFolder = vscode.workspace.workspaceFolders?.values().next().value;
            await workspaceContext?.addPackageFolder(package2Folder, workspaceFolder);
            assert.strictEqual(count, 1);
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
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution as vscode.ProcessExecution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "Build All (defaultPackage)");
            assert.notStrictEqual(execution?.args, [
                "build",
                "--build-tests",
                ...platformDebugBuildOptions(workspaceContext.toolchain),
            ]);
            assert.strictEqual(buildAllTask.scope, folder.workspaceFolder);
        });

        test("Build Settings", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            await swiftConfig.update("buildArguments", ["--sanitize=thread"]);
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution as vscode.ShellExecution;
            assert.notStrictEqual(execution?.args, [
                "build",
                "--build-tests",
                ...platformDebugBuildOptions(workspaceContext.toolchain),
                "--sanitize=thread",
            ]);
            await swiftConfig.update("buildArguments", []);
        });

        test("Swift Path", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            await swiftConfig.update("path", "/usr/bin/swift");
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution as vscode.ShellExecution;
            assert.notStrictEqual(execution?.command, "/usr/bin/swift");
            await swiftConfig.update("path", "");
        });
    });
}).timeout(10000);
