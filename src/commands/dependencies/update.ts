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
import { SwiftTaskProvider, createSwiftTask } from "../../tasks/SwiftTaskProvider";
import { packageName } from "../../utilities/tasks";
import { executeTaskWithUI, updateAfterError } from "./../utilities";

/**
 * Executes a {@link vscode.Task task} to update this package's dependencies.
 */
export async function updateDependencies(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        ctx.logger.debug("currentFolder is not set.", { label: "updateDependencies" });
        return false;
    }
    return await updateFolderDependencies(current);
}

/**
 * Run `swift package update` inside a folder
 * @param folderContext folder to run update inside
 */
async function updateFolderDependencies(folderContext: FolderContext) {
    const task = createSwiftTask(
        ["package", "update"],
        SwiftTaskProvider.updatePackageName,
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            packageName: packageName(folderContext),
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
        },
        folderContext.toolchain
    );

    const logger = folderContext.workspaceContext.logger;
    const startTime = Date.now();
    logger.debug(`Starting "swift package update"`, { label: folderContext.name });
    const result = await executeTaskWithUI(task, "Updating Dependencies", folderContext);
    logger.debug(
        `Finished "swift package update" in ${Date.now() - startTime}ms (success=${result})`,
        { label: folderContext.name }
    );
    updateAfterError(result, folderContext);
    return result;
}
