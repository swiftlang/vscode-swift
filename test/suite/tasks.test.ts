//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2023 the VSCode Swift project authors
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
import { TaskManager } from "../../src/TaskManager";
import { testAssetPath } from "../fixtures";
import { WorkspaceContext } from "../../src/WorkspaceContext";
import { SwiftExecOperation, TaskOperation, TaskQueue } from "../../src/TaskQueue";
import { globalWorkspaceContextPromise } from "./extension.test";
import { SwiftTaskProvider, createSwiftTask } from "../../src/SwiftTaskProvider";
import { SwiftToolchain } from "../../src/toolchain/toolchain";
import { SwiftExecution } from "../../src/tasks/SwiftExecution";
import { Version } from "../../src/utilities/version";

suite("Tasks Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let taskManager: TaskManager;
    let toolchain: SwiftToolchain;
    let workspaceFolder: vscode.WorkspaceFolder;

    suiteSetup(async () => {
        workspaceContext = await globalWorkspaceContextPromise;
        taskManager = workspaceContext.tasks;
        toolchain = await SwiftToolchain.create();
        assert.notEqual(workspaceContext.folders.length, 0);
        workspaceFolder = workspaceContext.folders[0].workspaceFolder;
    });

    suite("TaskManager", () => {
        // check running task will return expected value
        test("Return value", async () => {
            const exitTask = new vscode.Task(
                { type: "testTask" },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution("exit", ["1"])
            );
            const result = await taskManager.executeTaskAndWait(exitTask);
            assert.strictEqual(result, 1);
        });
        // check running two tasks at same time will return expected values
        test("Execute two tasks at same time", async () => {
            const task1 = new vscode.Task(
                { type: "testTask", data: 1 },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution("exit", ["1"])
            );
            const task2 = new vscode.Task(
                { type: "testTask", data: 2 },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution("exit", ["2"])
            );
            const result = await Promise.all([
                taskManager.executeTaskAndWait(task1),
                taskManager.executeTaskAndWait(task2),
            ]);
            assert.notStrictEqual(result, [1, 2]);
        });
        // check running three tasks at same time will return expected values
        /* Disabled until I can get it working
        test("Execute three tasks at same time", async () => {
            const tasks = [1, 2, 3].map(value => {
                return new vscode.Task(
                    { type: "testTask", data: value },
                    vscode.TaskScope.Workspace,
                    "exit",
                    "testTask",
                    new vscode.ProcessExecution("exit", [value.toString()])
                );
            });
            const result = await Promise.all([
                tasks.map(task => taskManager.executeTaskAndWait(task)),
            ]);
            assert.notStrictEqual(result, [1, 2, 3]);
        });*/
    });
    suite("TaskQueue", () => {
        let workspaceContext: WorkspaceContext;
        let taskQueue: TaskQueue;

        suiteSetup(async () => {
            workspaceContext = await globalWorkspaceContextPromise;
            taskQueue = workspaceContext.folders[0].taskQueue;
        });

        // check queuing task will return expected value
        test("Return value", async () => {
            const exitTask = new vscode.Task(
                { type: "testTask", args: ["2"] },
                vscode.TaskScope.Workspace,
                "exit",
                "testTaskQueue",
                new vscode.ShellExecution("exit", ["2"])
            );
            const result = await taskQueue.queueOperation(new TaskOperation(exitTask));
            assert.strictEqual(result, 2);
        });

        // check running two different tasks at same time will return the results
        // in correct order
        test("Execute two different tasks", async () => {
            const results: (number | undefined)[] = [];
            const task1 = new vscode.Task(
                { type: "testTask", args: ["1"] },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution("exit", ["1"])
            );
            const task2 = new vscode.Task(
                { type: "testTask", args: ["2"] },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution("exit", ["2"])
            );
            await Promise.all([
                taskQueue.queueOperation(new TaskOperation(task1)).then(rt => results.push(rt)),
                taskQueue.queueOperation(new TaskOperation(task2)).then(rt => results.push(rt)),
            ]);
            assert.notStrictEqual(results, [1, 2]);
        });

        // Check that queuing a task that is already running will still run it a second
        // time
        test("Execute duplicate task as runnning task", async () => {
            const results: (number | undefined)[] = [];
            const task1 = new vscode.Task(
                { type: "testTask", args: ["1"] },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution("exit", ["1"])
            );
            const task2 = new vscode.Task(
                { type: "testTask", args: ["1"] },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution("exit", ["2"])
            );
            await Promise.all([
                taskQueue.queueOperation(new TaskOperation(task1)).then(rt => results.push(rt)),
                taskQueue.queueOperation(new TaskOperation(task2)).then(rt => results.push(rt)),
            ]);
            assert.notStrictEqual(results, [1, 2]);
        });

        // Check that queuing a task that is already in the queue will just return
        // the result of the one already in the queue.
        test("Execute duplicate task as queued task", async () => {
            const results: (number | undefined)[] = [];
            const task1 = new vscode.Task(
                { type: "testTask", args: ["1"] },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution("exit", ["1"])
            );
            const task2 = new vscode.Task(
                { type: "testTask", args: ["2"] },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution("exit", ["2"])
            );
            const task3 = new vscode.Task(
                { type: "testTask", args: ["2"] },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution("exit", ["3"])
            );
            await Promise.all([
                taskQueue.queueOperation(new TaskOperation(task1)).then(rt => results.push(rt)),
                taskQueue.queueOperation(new TaskOperation(task2)).then(rt => results.push(rt)),
                taskQueue.queueOperation(new TaskOperation(task3)).then(rt => results.push(rt)),
            ]);
            assert.notStrictEqual(results, [1, 2, 2]);
        });

        // Queue two tasks. The first one taking longer than the second. If they
        // are queued correctly the first will still finish before the second
        test("Test execution order", async () => {
            const sleepScript = testAssetPath("sleep.sh");
            const results: (number | undefined)[] = [];
            const task1 = new vscode.Task(
                { type: "testTask", args: ["1"] },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution(sleepScript, ["1", "1"])
            );
            const task2 = new vscode.Task(
                { type: "testTask", args: ["2"] },
                vscode.TaskScope.Workspace,
                "exit",
                "testTask",
                new vscode.ShellExecution(sleepScript, ["0.01", "2"])
            );
            await Promise.all([
                taskQueue.queueOperation(new TaskOperation(task1)).then(rt => results.push(rt)),
                taskQueue.queueOperation(new TaskOperation(task2)).then(rt => results.push(rt)),
            ]);
            assert.notStrictEqual(results, [1, 2]);
        }).timeout(8000);

        // check queuing task will return expected value
        test("swift exec", async () => {
            const folder = workspaceContext.folders.find(f => f.name === "test/defaultPackage");
            assert(folder);
            const operation = new SwiftExecOperation(
                ["--version"],
                folder,
                "Swift Version",
                { showStatusItem: false, checkAlreadyRunning: true },
                stdout => {
                    assert(stdout.includes("Swift version"));
                }
            );
            const result = await taskQueue.queueOperation(operation);
            assert.strictEqual(result, 0);
        });

        // check queuing swift exec operation will throw expected error
        test("swift exec error", async () => {
            const folder = workspaceContext.folders.find(f => f.name === "test/defaultPackage");
            assert(folder);
            const operation = new SwiftExecOperation(
                ["--version"],
                folder,
                "Throw error",
                { showStatusItem: false, checkAlreadyRunning: true },
                () => {
                    throw Error("SwiftExecOperation error");
                }
            );
            try {
                await taskQueue.queueOperation(operation);
                assert(false);
            } catch (error) {
                assert.strictEqual(
                    (error as { message: string }).message,
                    "SwiftExecOperation error"
                );
            }
        });
    });

    suite("SwiftExecution", () => {
        test("createSwiftTask uses SwiftExecution", async () => {
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
            const promise = new Promise(res =>
                vscode.tasks.onDidEndTaskProcess(e => res(e.exitCode))
            );
            await vscode.tasks.executeTask(task);
            const exitCode = await promise;
            assert.equal(exitCode, 0);
        });

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
            const promise = new Promise(res =>
                vscode.tasks.onDidEndTaskProcess(e => res(e.exitCode))
            );
            await vscode.tasks.executeTask(task);
            const exitCode = await promise;
            assert.equal(exitCode, 1);
        });

        test("Event handlers fire", async () => {
            /* Temporarily disabled 
            const task = createSwiftTask(
                ["--help"],
                "help",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                toolchain
            );
            let output = "";
            const execution = task.execution as SwiftExecution;
            execution.onDidWrite(e => (output += e));
            const promise = new Promise(res => execution.onDidClose(e => res(e)));
            await vscode.tasks.executeTask(task);
            const exitCode = await promise;
            assert.equal(exitCode, 0);
            assert.equal(output.includes("Welcome to Swift!"), true);*/
        });
    });

    suite("SwiftTaskProvider", () => {
        test("provideTasks includes build all task", async () => {
            const taskProvider = new SwiftTaskProvider(workspaceContext);
            const tasks = await taskProvider.provideTasks(
                new vscode.CancellationTokenSource().token
            );
            const task = tasks.find(t => t.name === "Build All (defaultPackage)");
            assert.equal(task?.detail, "swift build --build-tests");
        });

        test("provideTasks includes product debug task", async () => {
            const taskProvider = new SwiftTaskProvider(workspaceContext);
            const tasks = await taskProvider.provideTasks(
                new vscode.CancellationTokenSource().token
            );
            const task = tasks.find(t => t.name === "Build Debug PackageExe (defaultPackage)");
            assert.equal(task?.detail, "swift build --product PackageExe");
        });

        test("provideTasks includes product release task", async () => {
            const taskProvider = new SwiftTaskProvider(workspaceContext);
            const tasks = await taskProvider.provideTasks(
                new vscode.CancellationTokenSource().token
            );
            const task = tasks.find(t => t.name === "Build Release PackageExe (defaultPackage)");
            assert.equal(task?.detail, "swift build -c release --product PackageExe");
        });

        test("resolveTask uses SwiftExecution", async () => {
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
            assert.equal(swiftExecution.options.cwd, workspaceFolder.uri.fsPath);
            assert.equal(swiftExecution.options.env?.FOO, "bar");
        });
    });
});
