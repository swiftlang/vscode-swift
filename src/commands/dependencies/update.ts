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
import { FolderContext } from "../../FolderContext";
import { WorkspaceContext } from "../../WorkspaceContext";
import { createSwiftTask, SwiftTaskProvider } from "../../tasks/SwiftTaskProvider";
import { executeTaskWithUI, updateAfterError } from "./../utilities";

/**
 * Executes a {@link vscode.Task task} to update this package's dependencies.
 */
export async function updateDependencies(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    return await updateFolderDependencies(current);
}

/**
 * Run `swift package update` inside a folder
 * @param folderContext folder to run update inside
 */
export async function updateFolderDependencies(folderContext: FolderContext) {
    const task = createSwiftTask(
        ["package", "update"],
        SwiftTaskProvider.updatePackageName,
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            prefix: folderContext.name,
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
        },
        folderContext.workspaceContext.toolchain
    );

    const result = await executeTaskWithUI(task, "Updating Dependencies", folderContext);
    updateAfterError(result, folderContext);
    return result;
}
