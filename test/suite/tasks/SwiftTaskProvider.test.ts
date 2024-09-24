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

import * as vscode from "vscode";
import * as assert from "assert";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { folderContextPromise, globalWorkspaceContextPromise } from "../extension.test";
import {
    SwiftTaskProvider,
    createSwiftTask,
    createBuildAllTask,
    getBuildAllTask,
} from "../../../src/tasks/SwiftTaskProvider";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import {
    executeTaskAndWaitForResult,
    waitForEndTaskProcess,
    waitForNoRunningTasks,
} from "../../utilities";
import { Version } from "../../../src/utilities/version";
import { FolderContext } from "../../../src/FolderContext";
import { mockNamespace } from "../../unit-tests/MockUtils";
import { anything, when } from "ts-mockito";

suite("SwiftTaskProvider Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let toolchain: SwiftToolchain;
    let workspaceFolder: vscode.WorkspaceFolder;
    let folderContext: FolderContext;

    suiteSetup(async () => {
        workspaceContext = await globalWorkspaceContextPromise;
        toolchain = workspaceContext.toolchain;
        assert.notEqual(workspaceContext.folders.length, 0);
        workspaceFolder = workspaceContext.folders[0].workspaceFolder;

        // Make sure have another folder
        folderContext = await folderContextPromise("diagnostics");
    });

    suite("createSwiftTask", () => {
        setup(async () => {
            await waitForNoRunningTasks();
        });

        test("Exit code on success", async () => {
            const task = createSwiftTask(
                ["--help"],
                "help",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                toolchain
            );
            const { exitCode } = await executeTaskAndWaitForResult(task);
            assert.equal(exitCode, 0);
        }).timeout(10000);

        test("Exit code on failure", async () => {
            const task = createSwiftTask(
                ["--help"],
                "help",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                new SwiftToolchain(
                    "/invalid/swift/path",
                    "/invalid/toolchain/path",
                    {
                        compilerVersion: "1.2.3",
                        paths: {
                            runtimeLibraryPaths: [],
                        },
                    },
                    new Version(1, 2, 3)
                )
            );
            const { exitCode } = await executeTaskAndWaitForResult(task);
            assert.equal(exitCode, 1);
        }).timeout(10000);
    });

    suite("provideTasks", () => {
        suite("includes build all task from extension", () => {
            let task: vscode.Task | undefined;

            setup(async () => {
                const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
                task = tasks.find(t => t.name === "Build All (defaultPackage)");
            });

            test("provided", async () => {
                assert.equal(
                    task?.detail,
                    "swift build --build-tests -Xswiftc -diagnostic-style=llvm"
                );
            });

            test("executes", async () => {
                assert(task);
                const exitPromise = waitForEndTaskProcess(task);
                await vscode.tasks.executeTask(task);
                const exitCode = await exitPromise;
                assert.equal(exitCode, 0);
            }).timeout(180000); // 3 minutes to build
        });

        suite("includes build all task from tasks.json", () => {
            let task: vscode.Task | undefined;

            setup(async () => {
                const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
                task = tasks.find(t => t.name === "swift: Build All from tasks.json");
            });

            test("provided", async () => {
                assert.equal(task?.detail, "swift build --show-bin-path");
            });

            test("executes", async () => {
                assert(task);
                const exitPromise = waitForEndTaskProcess(task);
                await vscode.tasks.executeTask(task);
                const exitCode = await exitPromise;
                assert.equal(exitCode, 0);
            });
        });

        test("includes product debug task", async () => {
            const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
            const task = tasks.find(t => t.name === "Build Debug PackageExe (defaultPackage)");
            assert.equal(
                task?.detail,
                "swift build --product PackageExe -Xswiftc -diagnostic-style=llvm"
            );
        });

        test("includes product release task", async () => {
            const taskProvider = new SwiftTaskProvider(workspaceContext);
            const tasks = await taskProvider.provideTasks(
                new vscode.CancellationTokenSource().token
            );
            const task = tasks.find(t => t.name === "Build Release PackageExe (defaultPackage)");
            assert.equal(
                task?.detail,
                "swift build -c release --product PackageExe -Xswiftc -diagnostic-style=llvm"
            );
        });

        test("includes additional folders", async () => {
            const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
            const diagnosticTasks = tasks.filter(t => t.name.endsWith("(diagnostics)"));
            assert.equal(diagnosticTasks.length, 3);
        });
    });

    suite("createBuildAllTask", () => {
        test("should return same task instance", async () => {
            assert.strictEqual(
                createBuildAllTask(folderContext),
                createBuildAllTask(folderContext)
            );
        });

        test("different task returned for release mode", async () => {
            assert.notEqual(
                createBuildAllTask(folderContext),
                createBuildAllTask(folderContext, true)
            );
        });
    });

    suite("getBuildAllTask", () => {
        const tasksMock = mockNamespace(vscode, "tasks");

        test("creates build all task when it cannot find one", async () => {
            when(tasksMock.fetchTasks()).thenReturn(Promise.resolve([]));
            when(tasksMock.fetchTasks(anything())).thenReturn(Promise.resolve([]));
            assert.strictEqual(
                await getBuildAllTask(folderContext),
                createBuildAllTask(folderContext)
            );
        });
    });
});
