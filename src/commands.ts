//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { WorkspaceContext } from "./WorkspaceContext";
import { executeTaskAndWait, createSwiftTask, SwiftTaskProvider } from "./SwiftTaskProvider";
import { FolderContext } from "./FolderContext";

/**
 * References:
 *
 * - Contributing commands:
 *   https://code.visualstudio.com/api/references/contribution-points#contributes.commands
 * - Implementing commands:
 *   https://code.visualstudio.com/api/extension-guides/command
 */

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
export async function resolveFolderDependencies(folderContext: FolderContext) {
    // Is an update or resolve task already running for this folder
    const index = vscode.tasks.taskExecutions.findIndex(
        exe =>
            (exe.task.name === SwiftTaskProvider.resolvePackageName ||
                exe.task.name === SwiftTaskProvider.updatePackageName) &&
            exe.task.scope === folderContext.folder
    );
    if (index !== -1) {
        return;
    }

    const workspaceContext = folderContext.workspaceContext;
    workspaceContext.outputChannel.logStart(
        "Resolving Dependencies ... ",
        folderContext.folder.name
    );
    const task = createSwiftTask(["package", "resolve"], SwiftTaskProvider.resolvePackageName, {
        scope: folderContext.folder,
        presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
    });
    workspaceContext.statusItem.start(task);
    try {
        await executeTaskAndWait(task);
        workspaceContext.outputChannel.logEnd("done.");
    } catch (error) {
        workspaceContext.outputChannel.logEnd(`${error}`);
    }
    workspaceContext.statusItem.end(task);
}

/**
 * Executes a {@link vscode.Task task} to update this package's dependencies.
 */
export async function updateDependencies(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    await updateFolderDependencies(current);
}

/**
 * Run `swift package update` inside a folder
 * @param folderContext folder to run update inside
 * @returns
 */
export async function updateFolderDependencies(folderContext: FolderContext) {
    // Is an update task already running for this folder
    const index = vscode.tasks.taskExecutions.findIndex(
        exe =>
            exe.task.name === SwiftTaskProvider.updatePackageName &&
            exe.task.scope === folderContext.folder
    );
    if (index !== -1) {
        return;
    }

    const workspaceContext = folderContext.workspaceContext;
    const task = createSwiftTask(["package", "update"], SwiftTaskProvider.updatePackageName, {
        scope: folderContext.folder,
        presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
    });
    workspaceContext.outputChannel.logStart(
        "Updating Dependencies ... ",
        folderContext.folder.name
    );
    workspaceContext.statusItem.start(task);
    try {
        await executeTaskAndWait(task);
        workspaceContext.outputChannel.logEnd("done.");
    } catch (error) {
        workspaceContext.outputChannel.logEnd(`${error}`);
    }
    workspaceContext.statusItem.end(task);
}

/**
 * Executes a {@link vscode.Task task} to delete all build artifacts.
 */
export async function cleanBuild(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    await folderCleanBuild(current);
}

/**
 * Run `swift package clean` inside a folder
 * @param folderContext folder to run update inside
 */
export async function folderCleanBuild(folderContext: FolderContext) {
    const workspaceContext = folderContext.workspaceContext;
    const task = createSwiftTask(["package", "clean"], SwiftTaskProvider.cleanBuildName, {
        scope: folderContext.folder,
        presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
        group: vscode.TaskGroup.Clean,
    });
    workspaceContext.outputChannel.logStart("Clean Build ... ", folderContext.folder.name);
    workspaceContext.statusItem.start(task);
    try {
        await executeTaskAndWait(task);
        workspaceContext.outputChannel.logEnd("done.");
    } catch (error) {
        workspaceContext.outputChannel.logEnd(`${error}`);
    }
    workspaceContext.statusItem.end(task);
}

/**
 * Executes a {@link vscode.Task task} to reset the complete cache/build directory.
 */
export async function resetPackage(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    await folderResetPackage(current);
}

/**
 * Run `swift package reset` inside a folder
 * @param folderContext folder to run update inside
 */
export async function folderResetPackage(folderContext: FolderContext) {
    const workspaceContext = folderContext.workspaceContext;
    const task = createSwiftTask(["package", "reset"], "Reset Package Dependencies", {
        scope: folderContext.folder,
        presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
        group: vscode.TaskGroup.Clean,
    });
    workspaceContext.outputChannel.logStart("Reset Package ... ", folderContext.folder.name);
    workspaceContext.statusItem.start(task);
    try {
        await executeTaskAndWait(task);
        workspaceContext.outputChannel.logEnd("done.");
    } catch (error) {
        workspaceContext.outputChannel.logEnd(`${error}`);
    }
    workspaceContext.statusItem.end(task);
}

/**
 * Registers this extension's commands in the given {@link vscode.ExtensionContext context}.
 */
export function register(ctx: WorkspaceContext) {
    ctx.extensionContext.subscriptions.push(
        vscode.commands.registerCommand("swift.resolveDependencies", () => {
            resolveDependencies(ctx);
        }),
        vscode.commands.registerCommand("swift.updateDependencies", () => {
            updateDependencies(ctx);
        }),
        vscode.commands.registerCommand("swift.cleanBuild", () => {
            cleanBuild(ctx);
        }),
        vscode.commands.registerCommand("swift.resetPackage", () => {
            resetPackage(ctx);
        })
    );
}
