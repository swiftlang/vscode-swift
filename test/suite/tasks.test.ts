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
import { testAssetPath, testAssetUri, testAssetWorkspaceFolder } from "../fixtures";
import { WorkspaceContext } from "../../src/WorkspaceContext";
import { TaskQueue } from "../../src/TaskQueue";

suite("Tasks Test Suite", () => {
    const taskManager = new TaskManager();

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
        });
    });
    suite("TaskQueue", () => {
        let workspaceContext: WorkspaceContext;
        let taskQueue: TaskQueue;
        const subscriptions: { dispose(): unknown }[] = [];
        const packageFolder: vscode.WorkspaceFolder = testAssetWorkspaceFolder("package1");

        suiteSetup(async () => {
            workspaceContext = await WorkspaceContext.create();
            await workspaceContext.addWorkspaceFolder(packageFolder);
            taskQueue = workspaceContext.folders[0].taskQueue;
            subscriptions.push(workspaceContext);
        });

        suiteTeardown(async () => {
            workspaceContext?.removeFolder(packageFolder);
            subscriptions.forEach(sub => sub.dispose());
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
            const result = await taskQueue.queueOperation({ task: exitTask });
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
                taskQueue.queueOperation({ task: task1 }).then(rt => results.push(rt)),
                taskQueue.queueOperation({ task: task2 }).then(rt => results.push(rt)),
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
                taskQueue.queueOperation({ task: task1 }).then(rt => results.push(rt)),
                taskQueue.queueOperation({ task: task2 }).then(rt => results.push(rt)),
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
                taskQueue.queueOperation({ task: task1 }).then(rt => results.push(rt)),
                taskQueue.queueOperation({ task: task2 }).then(rt => results.push(rt)),
                taskQueue.queueOperation({ task: task3 }).then(rt => results.push(rt)),
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
                taskQueue.queueOperation({ task: task1 }).then(rt => results.push(rt)),
                taskQueue.queueOperation({ task: task2 }).then(rt => results.push(rt)),
            ]);
            assert.notStrictEqual(results, [1, 2]);
        });
    });
});
