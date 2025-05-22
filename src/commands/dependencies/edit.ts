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
import { createSwiftTask } from "../../tasks/SwiftTaskProvider";
import { FolderOperation, WorkspaceContext } from "../../WorkspaceContext";
import { executeTaskWithUI } from "../utilities";

/**
 * Setup package dependency to be edited
 * @param identifier Identifier of dependency we want to edit
 * @param ctx workspace context
 */
export async function editDependency(identifier: string, ctx: WorkspaceContext) {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        return;
    }

    const task = createSwiftTask(
        ["package", "edit", identifier],
        "Edit Package Dependency",
        {
            scope: currentFolder.workspaceFolder,
            cwd: currentFolder.folder,
            prefix: currentFolder.name,
        },
        currentFolder.toolchain
    );

    const success = await executeTaskWithUI(
        task,
        `edit locally ${identifier}`,
        currentFolder,
        true
    );

    if (success) {
        await ctx.fireEvent(currentFolder, FolderOperation.resolvedUpdated);
        // add folder to workspace
        const index = vscode.workspace.workspaceFolders?.length ?? 0;
        vscode.workspace.updateWorkspaceFolders(index, 0, {
            uri: vscode.Uri.file(currentFolder.editedPackageFolder(identifier)),
            name: identifier,
        });
    }
}
