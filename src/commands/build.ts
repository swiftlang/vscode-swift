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
import { Target } from "../SwiftPackage";
import { WorkspaceContext } from "../WorkspaceContext";
import { debugLaunchConfig, getLaunchConfiguration } from "../debugger/launch";
import { SwiftTaskProvider, createSwiftTask } from "../tasks/SwiftTaskProvider";
import { packageName } from "../utilities/tasks";
import { executeTaskWithUI } from "./utilities";

/**
 * Executes a {@link vscode.Task task} to run swift target.
 */
export async function runBuild(ctx: WorkspaceContext, target?: string) {
    return await debugBuildWithOptions(ctx, { noDebug: true }, target);
}

/**
 * Executes a {@link vscode.Task task} to debug swift target.
 */
export async function debugBuild(ctx: WorkspaceContext, target?: string) {
    return await debugBuildWithOptions(ctx, {}, target);
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
            packageName: packageName(folderContext),
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
            group: vscode.TaskGroup.Clean,
        },
        folderContext.toolchain
    );

    return await executeTaskWithUI(task, "Clean Build", folderContext);
}

/**
 * Executes a {@link vscode.Task task} to debug swift target.
 */
export async function debugBuildWithOptions(
    ctx: WorkspaceContext,
    options: vscode.DebugSessionOptions,
    targetName?: string
) {
    const current = ctx.currentFolder;
    if (!current) {
        ctx.logger.debug("debugBuildWithOptions: No current folder on WorkspaceContext");
        return;
    }

    let target: Target | undefined;
    if (targetName) {
        const targets = await current.swiftPackage.targets;
        target = targets.find(target => target.name === targetName);
    } else {
        const file = vscode.window.activeTextEditor?.document.fileName;
        if (!file) {
            ctx.logger.debug("debugBuildWithOptions: No active text editor");
            return;
        }

        target = await current.swiftPackage.getTarget(file);
    }

    if (!target) {
        ctx.logger.debug("debugBuildWithOptions: No active target");
        return;
    }

    if (target.type !== "executable") {
        ctx.logger.debug(
            `debugBuildWithOptions: Target is not an executable, instead is ${target.type}`
        );
        return;
    }

    const launchConfig = getLaunchConfiguration(target.name, current);
    if (launchConfig) {
        ctx.buildStarted(target.name, launchConfig, options);
        const result = await debugLaunchConfig(
            vscode.workspace.workspaceFile ? undefined : current.workspaceFolder,
            launchConfig,
            options
        );
        ctx.buildFinished(target.name, launchConfig, options);
        return result;
    }
}
