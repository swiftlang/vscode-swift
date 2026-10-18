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
import { unwrapPromise } from "@src/utilities/utilities";
import { withTimeout } from "@src/utilities/withTimeout";

import { tag } from "../../tags";
import { sleepExecution, waitForNoRunningTasks } from "../../utilities/tasks";
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
            sleepExecution(60)
        );
        const result = manager.executeTaskAndWait(sleepTask);

        // Dispose before VS Code has finished starting the task.
        await manager.dispose();

        const exitCode = await withTimeout("Waiting for the terminated task", () => result, 10_000);
        expect(exitCode).to.be.undefined;
        expect(await waitForNoRunningTasks({ timeout: 10_000 })).to.be.empty;
    });

    test("Terminates a task that starts after dispose", async () => {
        const manager = new TaskManager(workspaceContext);
        const { promise: startReleased, resolve: releaseStart } = unwrapPromise<void>();
        const closeEmitter = new vscode.EventEmitter<number | void>();
        let closed = false;
        const pty: vscode.Pseudoterminal = {
            onDidWrite: new vscode.EventEmitter<string>().event,
            onDidClose: closeEmitter.event,
            open: () => {},
            close: () => {
                closed = true;
                closeEmitter.fire();
            },
        };
        const lateTask = new vscode.Task(
            { type: "testTask" },
            vscode.TaskScope.Workspace,
            "late start",
            "testTask",
            // VS Code doesn't report the task as started until this resolves
            new vscode.CustomExecution(async () => {
                await startReleased;
                return pty;
            })
        );
        void manager.executeTaskAndWait(lateTask);

        await manager.dispose();
        releaseStart();

        expect(await waitForNoRunningTasks({ timeout: 10_000 })).to.be.empty;
        expect(closed).to.be.true;
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
