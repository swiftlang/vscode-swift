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
import { testAssetPath } from "../../fixtures";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { SwiftExecOperation, TaskOperation, TaskQueue } from "../../../src/tasks/TaskQueue";
import { waitForNoRunningTasks } from "../../utilities";
import { activateExtensionForSuite } from "../utilities/testutilities";

suite("TaskQueue Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let taskQueue: TaskQueue;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            assert.notEqual(workspaceContext.folders.length, 0);
            taskQueue = workspaceContext.folders[0].taskQueue;
        },
    });

    setup(async () => {
        await waitForNoRunningTasks();
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
            assert.strictEqual((error as { message: string }).message, "SwiftExecOperation error");
        }
    });
});
