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
import { createSwiftTask, SwiftTaskProvider } from "../../tasks/SwiftTaskProvider";
import { WorkspaceContext } from "../../WorkspaceContext";
import { executeTaskWithUI, updateAfterError } from "../utilities";

/**
 * Executes a {@link vscode.Task task} to resolve this package's dependencies.
 */
export async function resolveDependencies(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    await resolveFolderDependencies(current);
}

/**
 * Run `swift package resolve` inside a folder
 * @param folderContext folder to run resolve for
 */
export async function resolveFolderDependencies(
    folderContext: FolderContext,
    checkAlreadyRunning?: boolean
) {
    const task = createSwiftTask(
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

    const success = await executeTaskWithUI(
        task,
        "Resolving Dependencies",
        folderContext,
        false,
        checkAlreadyRunning
    );
    updateAfterError(success, folderContext);
}
