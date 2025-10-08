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
import { expect } from "chai";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { createBuildAllTask, createSwiftTask, getBuildAllTask } from "@src/tasks/SwiftTaskProvider";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Version } from "@src/utilities/version";

import { mockGlobalObject } from "../../MockUtils";
import { tag } from "../../tags";
import { executeTaskAndWaitForResult, waitForEndTaskProcess } from "../../utilities/tasks";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "../utilities/testutilities";

suite("SwiftTaskProvider Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let toolchain: SwiftToolchain;
    let workspaceFolder: vscode.WorkspaceFolder;
    let folderContext: FolderContext;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            expect(workspaceContext.folders).to.not.have.lengthOf(0);
            workspaceFolder = workspaceContext.folders[0].workspaceFolder;

            // Make sure have another folder
            folderContext = await folderInRootWorkspace("diagnostics", workspaceContext);
            toolchain = folderContext.toolchain;
        },
    });

    suite("createSwiftTask", () => {
        test("Exit code on success", async () => {
            const task = createSwiftTask(
                ["--help"],
                "help",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                toolchain
            );
            const { exitCode } = await executeTaskAndWaitForResult(task);
            expect(exitCode).to.equal(0);
        });

        test("Exit code on failure", async () => {
            const task = createSwiftTask(
                ["invalid_swift_command"],
                "invalid",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                toolchain
            );
            const { exitCode } = await executeTaskAndWaitForResult(task);
            expect(exitCode).to.not.equal(0);
        });

        test("Exit code on failure to launch", async () => {
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
            expect(exitCode).to.not.equal(0);
        });
    });

    suite("provideTasks", () => {
        let resetSettings: (() => Promise<void>) | undefined;
        teardown(async () => {
            if (resetSettings) {
                await resetSettings();
            }
        });

        suite("includes build all task from extension", () => {
            async function getBuildAllTask(): Promise<vscode.Task | undefined> {
                const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
                return tasks.find(t => t.name === "Build All (defaultPackage)");
            }

            test("provided", async () => {
                const task = await getBuildAllTask();
                expect(task?.detail).to.include("swift build --build-tests");
            });

            tag("medium").test("executes", async () => {
                const task = await getBuildAllTask();
                assert(task);
                const exitPromise = waitForEndTaskProcess(task);
                await vscode.tasks.executeTask(task);
                const exitCode = await exitPromise;
                expect(exitCode).to.equal(0);
            });
        });

        suite("includes build all task from tasks.json", () => {
            async function getBuildAllTask(): Promise<vscode.Task | undefined> {
                const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
                return tasks.find(
                    t =>
                        t.name ===
                        "swift: Build All from " +
                            (vscode.workspace.workspaceFile ? "code workspace" : "tasks.json")
                );
            }

            test("provided", async () => {
                const task = await getBuildAllTask();
                expect(task?.detail).to.include("swift build --show-bin-path");
            });

            tag("medium").test("executes", async () => {
                const task = await getBuildAllTask();
                assert(task);
                const exitPromise = waitForEndTaskProcess(task);
                await vscode.tasks.executeTask(task);
                const exitCode = await exitPromise;
                expect(exitCode).to.equal(0);
            });
        });

        test("includes product debug task", async () => {
            const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
            const task = tasks.find(t => t.name === "Build Debug PackageExe (defaultPackage)");
            expect(
                task,
                'expected to find a task named "Build Debug PackageExe (defaultPackage)", instead found ' +
                    tasks.map(t => t.name)
            ).to.not.be.undefined;
            expect(task?.detail).to.include("swift build --product PackageExe");
        });

        test("includes library build tasks task", async () => {
            const taskProvider = workspaceContext.taskProvider;
            let tasks = await taskProvider.provideTasks(new vscode.CancellationTokenSource().token);
            let task = tasks.find(t => t.name === "Build Debug PackageLib2 (defaultPackage)");
            expect(task).to.be.undefined;
            task = tasks.find(t => t.name === "Build Release PackageLib2 (defaultPackage)");
            expect(task).to.be.undefined;

            resetSettings = await updateSettings({
                "swift.createTasksForLibraryProducts": true,
            });

            tasks = await taskProvider.provideTasks(new vscode.CancellationTokenSource().token);
            task = tasks.find(t => t.name === "Build Debug PackageLib2 (defaultPackage)");
            expect(
                task,
                'expected to find a task named "Build Debug PackageLib2 (defaultPackage)", instead found ' +
                    tasks.map(t => t.name)
            ).to.not.be.undefined;
            expect(task?.detail).to.include("swift build --product PackageLib2");
            task = tasks.find(t => t.name === "Build Release PackageLib2 (defaultPackage)");
            expect(
                task,
                'expected to find a task named "Build Release PackageLib2 (defaultPackage)", instead found ' +
                    tasks.map(t => t.name)
            ).to.not.be.undefined;
            expect(task?.detail).to.include("swift build -c release --product PackageLib2");

            // Don't include automatic products
            task = tasks.find(t => t.name === "Build Debug PackageLib (defaultPackage)");
            expect(task).to.be.undefined;
            task = tasks.find(t => t.name === "Build Release PackageLib (defaultPackage)");
            expect(task).to.be.undefined;
        });

        test("includes product release task", async () => {
            const taskProvider = workspaceContext.taskProvider;
            const tasks = await taskProvider.provideTasks(
                new vscode.CancellationTokenSource().token
            );
            const task = tasks.find(t => t.name === "Build Release PackageExe (defaultPackage)");
            expect(
                task,
                'expected to find a task named "Build Release PackageExe (defaultPackage)", instead found ' +
                    tasks.map(t => t.name)
            ).to.not.be.undefined;
            expect(task?.detail).to.include("swift build -c release --product PackageExe");
        });

        test("includes additional folders", async () => {
            const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
            const diagnosticTasks = tasks.filter(t => t.name.endsWith("(diagnostics)"));
            expect(diagnosticTasks).to.have.lengthOf(3);
        });
    });

    suite("createBuildAllTask", () => {
        test("should return same task instance", async () => {
            expect(await createBuildAllTask(folderContext)).to.equal(
                await createBuildAllTask(folderContext)
            );
        });

        test("different task returned for release mode", async () => {
            expect(await createBuildAllTask(folderContext)).to.not.equal(
                await createBuildAllTask(folderContext, true)
            );
        });
    });

    suite("getBuildAllTask", () => {
        const tasksMock = mockGlobalObject(vscode, "tasks");

        test("creates build all task when it cannot find one", async () => {
            tasksMock.fetchTasks.resolves([]);
            await expect(getBuildAllTask(folderContext)).to.eventually.equal(
                await createBuildAllTask(folderContext)
            );
        });
    });
});
