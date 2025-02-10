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
import { FolderContext } from "../FolderContext";
import { createSwiftTask, SwiftTaskProvider } from "../tasks/SwiftTaskProvider";
import { WorkspaceContext } from "../WorkspaceContext";
import { executeTaskWithUI } from "./utilities";
import configuration from "../configuration";

/**
 * Executes a {@link vscode.Task task} to reset the complete cache/build directory.
 */
export async function resetPackage(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    return await folderResetPackage(current);
}

/**
 * Run `swift package reset` inside a folder
 * @param folderContext folder to run update inside
 */
export async function folderResetPackage(folderContext: FolderContext) {
    const task = createSwiftTask(
        ["package", "reset"],
        "Reset Package Dependencies",
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            prefix: folderContext.name,
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
            group: vscode.TaskGroup.Clean,
        },
        folderContext.workspaceContext.toolchain
    );

    return await executeTaskWithUI(task, "Reset Package", folderContext).then(
        async success => {
            if (!success) {
                return false;
            }
            const resolveTask = createSwiftTask(
                ["package", "resolve"],
                SwiftTaskProvider.resolvePackageName,
                {
                    cwd: folderContext.folder,
                    scope: folderContext.workspaceFolder,
                    prefix: folderContext.name,
                    presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
                },
                folderContext.workspaceContext.toolchain
            );

            const result = await executeTaskWithUI(
                resolveTask,
                "Resolving Dependencies",
                folderContext
            );
            return result;
        },
        reason => {
            return reason;
        }
    );
}
