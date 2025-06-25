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
import { packageName } from "../utilities/tasks";

/**
 * Executes a {@link vscode.Task task} to reset the complete cache/build directory.
 */
export async function resetPackage(ctx: WorkspaceContext, folder: FolderContext | undefined) {
    const current = folder ?? ctx.currentFolder;
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
        folderContext.toolchain.buildFlags.withAdditionalFlags(["package", "reset"]),
        "Reset Package Dependencies",
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            packageName: packageName(folderContext),
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
            group: vscode.TaskGroup.Clean,
        },
        folderContext.toolchain
    );

    const languageClientManager = () =>
        folderContext.workspaceContext.languageClientManager.get(folderContext);
    const shouldStop = process.platform === "win32";
    if (shouldStop) {
        await vscode.window.withProgress(
            {
                title: "Stopping the SourceKit-LSP server",
                location: vscode.ProgressLocation.Window,
            },
            async () => await languageClientManager().stop(false)
        );
    }

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
                    packageName: packageName(folderContext),
                    presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
                },
                folderContext.toolchain
            );

            const result = await executeTaskWithUI(
                resolveTask,
                "Resolving Dependencies",
                folderContext
            );
            if (shouldStop) {
                await languageClientManager().restart();
            }
            return result;
        },
        reason => {
            return reason;
        }
    );
}
