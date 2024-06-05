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
import { globalWorkspaceContextPromise } from "../extension.test";
import { SwiftTaskProvider, createSwiftTask } from "../../../src/tasks/SwiftTaskProvider";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { SwiftExecution } from "../../../src/tasks/SwiftExecution";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities";
import { Version } from "../../../src/utilities/version";

suite("SwiftTaskProvider Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let toolchain: SwiftToolchain;
    let workspaceFolder: vscode.WorkspaceFolder;

    suiteSetup(async () => {
        workspaceContext = await globalWorkspaceContextPromise;
        toolchain = await SwiftToolchain.create();
        assert.notEqual(workspaceContext.folders.length, 0);
        workspaceFolder = workspaceContext.folders[0].workspaceFolder;
    });

    suite("createSwiftTask", () => {
        setup(async () => {
            await waitForNoRunningTasks();
        });

        test("uses SwiftExecution", async () => {
            const task = createSwiftTask(
                ["--help"],
                "help",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                toolchain
            );
            assert.equal(task.execution instanceof SwiftExecution, true);
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
                    "1.2.3",
                    new Version(1, 2, 3)
                )
            );
            const { exitCode } = await executeTaskAndWaitForResult(task);
            assert.equal(exitCode, 1);
        }).timeout(10000);
    });

    suite("provideTasks", () => {
        test("includes build all task", async () => {
            const taskProvider = new SwiftTaskProvider(workspaceContext);
            const tasks = await taskProvider.provideTasks(
                new vscode.CancellationTokenSource().token
            );
            const task = tasks.find(t => t.name === "Build All (defaultPackage)");
            assert.equal(task?.detail, "swift build --build-tests -Xswiftc -diagnostic-style=llvm");
        });

        test("includes product debug task", async () => {
            const taskProvider = new SwiftTaskProvider(workspaceContext);
            const tasks = await taskProvider.provideTasks(
                new vscode.CancellationTokenSource().token
            );
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
    });

    suite("resolveTask", () => {
        test("uses SwiftExecution", async () => {
            const taskProvider = new SwiftTaskProvider(workspaceContext);
            const task = new vscode.Task(
                {
                    type: "swift",
                    args: ["run", "PackageExe"],
                    env: { FOO: "bar" },
                    cwd: workspaceFolder.uri.fsPath,
                },
                workspaceFolder,
                "run PackageExe",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            assert.equal(resolvedTask.execution instanceof SwiftExecution, true);
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.equal(
                swiftExecution.options.cwd,
                workspaceFolder.uri.fsPath,
                "Sets correct cwd"
            );
            assert.equal(
                swiftExecution.options.env?.FOO,
                "bar",
                "Sets provided environment variables"
            );
        });
    });
});
