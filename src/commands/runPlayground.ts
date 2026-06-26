//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { createSwiftTask } from "../tasks/SwiftTaskProvider";
import { TaskManager } from "../tasks/TaskManager";
import { packageName } from "../utilities/tasks";

interface PlaygroundItem {
    id: string;
    label?: string;
}

/**
 * Executes a {@link vscode.Task task} to run swift playground.
 */
export async function runPlayground(
    folderContext: FolderContext,
    tasks: TaskManager,
    item: PlaygroundItem
) {
    const id = item.label ?? item.id;
    const task = createSwiftTask(
        ["play", id],
        `Play "${id}"`,
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            packageName: packageName(folderContext),
            presentationOptions: { reveal: vscode.TaskRevealKind.Always },
        },
        folderContext.toolchain
    );

    await tasks.executeTaskAndWait(task);
    return true;
}
