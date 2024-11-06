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
import { FolderOperation, WorkspaceContext } from "../../WorkspaceContext";
import { createSwiftTask } from "../../tasks/SwiftTaskProvider";
import { executeTaskWithUI } from "../utilities";

/**
 * Use local version of package dependency
 *
 * equivalent of `swift package edit --path <localpath> identifier
 * @param identifier Identifier for dependency
 * @param ctx workspace context
 */
export async function useLocalDependency(
    identifier: string,
    ctx: WorkspaceContext
): Promise<boolean> {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        ctx.outputChannel.log("currentFolder is not set.");
        return false;
    }
    const folders = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: currentFolder.folder,
        openLabel: "Select",
        title: "Select folder",
    });

    if (!folders) {
        return false;
    }
    const folder = folders[0];
    const task = createSwiftTask(
        ["package", "edit", "--path", folder.fsPath, identifier],
        "Edit Package Dependency",
        {
            scope: currentFolder.workspaceFolder,
            cwd: currentFolder.folder,
            prefix: currentFolder.name,
        },
        ctx.toolchain
    );

    const success = await executeTaskWithUI(
        task,
        `Use local version of ${identifier}`,
        currentFolder,
        true
    );
    if (success) {
        ctx.fireEvent(currentFolder, FolderOperation.resolvedUpdated);
    }
    return success;
}
