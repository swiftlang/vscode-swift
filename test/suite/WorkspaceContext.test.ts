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
import { testAssetWorkspaceFolder } from "../fixtures";
import { FolderEvent, SwiftExtensionContext, WorkspaceContext } from "../../src/WorkspaceContext";
import { createBuildAllTask, win32BuildOptions } from "../../src/SwiftTaskProvider";

class TestExtensionContext implements SwiftExtensionContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly subscriptions: { dispose(): any }[] = [];
}

suite("WorkspaceContext Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    const packageFolder: vscode.WorkspaceFolder = testAssetWorkspaceFolder("package1");

    suiteSetup(async () => {
        workspaceContext = await WorkspaceContext.create(new TestExtensionContext());
        await workspaceContext.addWorkspaceFolder(packageFolder);
    });

    suiteTeardown(async () => {
        workspaceContext?.removeFolder(packageFolder);
        workspaceContext?.dispose();
    });

    suite("Folder Events", () => {
        test("Add/Remove", async () => {
            let count = 0;
            const observer = workspaceContext?.observeFolders((folder, operation) => {
                assert(folder !== null);
                assert.strictEqual(folder.swiftPackage.name, "package1");
                switch (operation) {
                    case FolderEvent.add:
                        count++;
                        break;
                    case FolderEvent.remove:
                        count--;
                        break;
                }
            });
            const packageFolder = testAssetWorkspaceFolder("package1");
            await workspaceContext?.addWorkspaceFolder(packageFolder);
            await workspaceContext?.removeFolder(packageFolder);
            assert.strictEqual(count, 0);
            observer?.dispose();
        }).timeout(5000);
    });

    suite("Tasks", async () => {
        test("Default Task values", async () => {
            const folder = workspaceContext.folders.find(f => f.workspaceFolder === packageFolder);
            assert(folder);
            const buildAllTask = createBuildAllTask(folder);
            assert(buildAllTask);
            const execution = buildAllTask.execution as vscode.ShellExecution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "Build All");
            if (process.platform === "win32") {
                assert.notStrictEqual(execution?.args, [
                    "build",
                    "--build-tests",
                    ...win32BuildOptions(),
                ]);
            } else {
                assert.notStrictEqual(execution?.args, ["build", "--build-tests"]);
            }
            assert.strictEqual(buildAllTask.scope, packageFolder);
        });

        test("Build Settings", async () => {
            const folder = workspaceContext.folders.find(f => f.workspaceFolder === packageFolder);
            assert(folder);
            vscode.workspace
                .getConfiguration("swift", packageFolder)
                .update("buildArguments", ["--sanitize=thread"]);
            const buildAllTask = createBuildAllTask(folder);
            assert(buildAllTask);
            const execution = buildAllTask.execution as vscode.ShellExecution;
            if (process.platform === "win32") {
                assert.notStrictEqual(execution?.args, [
                    "build",
                    "--build-tests",
                    ...win32BuildOptions(),
                    "--sanitize=thread",
                ]);
            } else {
                assert.notStrictEqual(execution?.args, [
                    "build",
                    "--build-tests",
                    "--sanitize=thread",
                ]);
            }
        });
    });
});
