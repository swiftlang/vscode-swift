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

import { WorkspaceContext } from "@src/WorkspaceContext";
import { TaskManager } from "@src/tasks/TaskManager";
import { withTimeout } from "@src/utilities/withTimeout";

import { testAssetPath } from "../../fixtures";
import { tag } from "../../tags";
import { waitForNoRunningTasks } from "../../utilities/tasks";
import { activateExtensionForSuite } from "../utilities/testutilities";

tag("medium").suite("TaskManager Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let taskManager: TaskManager;

    activateExtensionForSuite({
        async setup(api) {
            const ctx = await api.waitForWorkspaceContext();
            workspaceContext = ctx;
            taskManager = workspaceContext.tasks;
            assert.notEqual(workspaceContext.folders.length, 0);
        },
    });

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

    test("Terminates a task that starts while disposing", async () => {
        const manager = new TaskManager(workspaceContext);
        const sleepTask = new vscode.Task(
            { type: "testTask" },
            vscode.TaskScope.Workspace,
            "sleep",
            "testTask",
            new vscode.ShellExecution(testAssetPath("sleep.sh"), ["60", "0"])
        );
        const result = manager.executeTaskAndWait(sleepTask);

        // Dispose before VS Code has finished starting the task.
        await manager.dispose();

        const exitCode = await withTimeout("Waiting for the terminated task", () => result, 10_000);
        expect(exitCode).to.be.undefined;
        await waitForNoRunningTasks({ timeout: 10_000 });
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
        expect(result).to.deep.equal([1, 2]);
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
