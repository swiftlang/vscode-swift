//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { WorkspaceContext } from "../WorkspaceContext";
import { TaskOperation } from "../tasks/TaskQueue";

export const runTask = async (ctx: WorkspaceContext, name: string) => {
    if (!ctx.currentFolder) {
        return;
    }

    const tasks = await vscode.tasks.fetchTasks();
    let task = tasks.find(task => task.name === name);
    if (!task) {
        const pluginTaskProvider = ctx.pluginProvider;
        const pluginTasks = await pluginTaskProvider.provideTasks(
            new vscode.CancellationTokenSource().token
        );
        task = pluginTasks.find(task => task.name === name);
    }

    if (!task) {
        vscode.window.showErrorMessage(`Task "${name}" not found`);
        return;
    }

    return ctx.currentFolder.taskQueue
        .queueOperation(new TaskOperation(task))
        .then(result => result === 0);
};
