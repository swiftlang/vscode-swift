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
import { TaskManager } from "../../../src/tasks/TaskManager";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { waitForNoRunningTasks } from "../../utilities";
import { activateExtension, deactivateExtension } from "../utilities/testutilities";

suite("TaskManager Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let taskManager: TaskManager;

    suiteSetup(async () => {
        workspaceContext = await activateExtension();
        taskManager = workspaceContext.tasks;
        assert.notEqual(workspaceContext.folders.length, 0);
    });

    suiteTeardown(async () => {
        await deactivateExtension();
    });

    setup(async () => {
        await waitForNoRunningTasks();
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
