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
import { FolderOperation, WorkspaceContext } from "../../WorkspaceContext";
import { createSwiftTask } from "../../tasks/SwiftTaskProvider";
import { packageName } from "../../utilities/tasks";
import { executeTaskWithUI } from "../utilities";

/**
 * Setup package dependency to be edited
 * @param identifier Identifier of dependency we want to edit
 * @param ctx workspace context
 */
export async function editDependency(
    identifier: string,
    ctx: WorkspaceContext,
    folder: FolderContext | undefined
) {
    const currentFolder = folder ?? ctx.currentFolder;
    if (!currentFolder) {
        ctx.logger.debug("No current folder, not editing dependency", {
            label: "editDependency",
        });
        return;
    }

    const task = createSwiftTask(
        ["package", "edit", identifier],
        "Edit Package Dependency",
        {
            scope: currentFolder.workspaceFolder,
            cwd: currentFolder.folder,
            packageName: packageName(currentFolder),
        },
        currentFolder.toolchain
    );

    ctx.logger.debug(`Starting "swift package edit ${identifier}"`, { label: currentFolder.name });
    const success = await executeTaskWithUI(
        task,
        `edit locally ${identifier}`,
        currentFolder,
        true
    );
    ctx.logger.debug(`Finished "swift package edit ${identifier}" (success=${success})`, {
        label: currentFolder.name,
    });

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
