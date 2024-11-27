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
import { createSwiftTask, SwiftTaskProvider } from "../tasks/SwiftTaskProvider";
import { debugLaunchConfig, getLaunchConfiguration } from "../debugger/launch";
import { executeTaskWithUI } from "./utilities";
import { FolderContext } from "../FolderContext";

/**
 * Executes a {@link vscode.Task task} to run swift target.
 */
export async function runBuild(ctx: WorkspaceContext) {
    return await debugBuildWithOptions(ctx, { noDebug: true });
}

/**
 * Executes a {@link vscode.Task task} to debug swift target.
 */
export async function debugBuild(ctx: WorkspaceContext) {
    return await debugBuildWithOptions(ctx, {});
}

/**
 * Executes a {@link vscode.Task task} to delete all build artifacts.
 */
export async function cleanBuild(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    return await folderCleanBuild(current);
}

/**
 * Run `swift package clean` inside a folder
 * @param folderContext folder to run update inside
 */
export async function folderCleanBuild(folderContext: FolderContext) {
    const task = createSwiftTask(
        ["package", "clean"],
        SwiftTaskProvider.cleanBuildName,
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            prefix: folderContext.name,
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
            group: vscode.TaskGroup.Clean,
        },
        folderContext.workspaceContext.toolchain
    );

    return await executeTaskWithUI(task, "Clean Build", folderContext);
}

/**
 * Executes a {@link vscode.Task task} to debug swift target.
 */
export async function debugBuildWithOptions(
    ctx: WorkspaceContext,
    options: vscode.DebugSessionOptions
) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }

    const file = vscode.window.activeTextEditor?.document.fileName;
    if (!file) {
        return;
    }

    const target = current.swiftPackage.getTarget(file);
    if (!target || target.type !== "executable") {
        return;
    }

    const launchConfig = getLaunchConfiguration(target.name, current);
    if (launchConfig) {
        return debugLaunchConfig(current.workspaceFolder, launchConfig, options);
    }
}
