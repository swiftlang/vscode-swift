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
import { PackageNode } from "./ui/PackageDependencyProvider";
import { execSwift } from "./utilities/utilities";

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
        const resolveTask = createSwiftTask(
            ["package", "resolve"],
            SwiftTaskProvider.resolvePackageName,
            {
                scope: folderContext.folder,
                presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
            }
        );
        await executeTaskAndWait(resolveTask);
        workspaceContext.outputChannel.logEnd("done.");
    } catch (error) {
        workspaceContext.outputChannel.logEnd(`${error}`);
    }
    workspaceContext.statusItem.end(task);
}

export async function editDependency(identifier: string, ctx: WorkspaceContext) {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        return;
    }
    vscode.window
        .showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: currentFolder.folder.uri,
            openLabel: "Select",
            title: "Select folder",
        })
        .then(async value => {
            if (!value) {
                return;
            }
            const folder = value[0];
            ctx.outputChannel.log(
                `Edit dependency ${identifier} from ${folder.fsPath}`,
                currentFolder.folder.name
            );
            const status = `Edit dependency ${identifier} (${currentFolder.folder.name})`;
            ctx.statusItem.start(status);
            try {
                await execSwift(["package", "edit", "--path", value[0].fsPath, identifier], {
                    cwd: currentFolder.folder.uri.fsPath,
                });
                await updateDependencies(ctx);
                const existingFolder = ctx.folders.findIndex(item => item.folder.uri === folder);
                if (existingFolder !== -1) {
                    return;
                }
            } catch (error) {
                const execError = error as { stderr: string };
                ctx.outputChannel.log(execError.stderr, currentFolder.folder.name);
                vscode.window.showErrorMessage(`${execError.stderr}`);
            }
            ctx.statusItem.end(status);
        });
}

export async function uneditDependency(identifier: string, ctx: WorkspaceContext) {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        return;
    }
    ctx.outputChannel.log(`Unedit dependency ${identifier}}`, currentFolder.folder.name);
    const status = `Unedit dependency ${identifier} (${currentFolder.folder.name})`;
    ctx.statusItem.start(status);
    try {
        await execSwift(["package", "unedit", identifier], {
            cwd: currentFolder.folder.uri.fsPath,
        });
    } catch (error) {
        const execError = error as { stderr: string };
        ctx.outputChannel.log(execError.stderr, currentFolder.folder.name);
        vscode.window.showErrorMessage(`${execError.stderr}`);
    }
    ctx.statusItem.end(status);
}

async function openInWorkspace(packageNode: PackageNode, ctx: WorkspaceContext) {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        return;
    }
    const index = vscode.workspace.workspaceFolders?.length ?? 0;
    vscode.workspace.updateWorkspaceFolders(index, 0, {
        uri: vscode.Uri.file(packageNode.path),
        name: packageNode.name,
    });
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
        }),
        vscode.commands.registerCommand("swift.editDependency", item => {
            if (item instanceof PackageNode) {
                editDependency(item.name, ctx);
            }
        }),
        vscode.commands.registerCommand("swift.uneditDependency", item => {
            if (item instanceof PackageNode) {
                uneditDependency(item.name, ctx);
            }
        }),
        vscode.commands.registerCommand("swift.openInWorkspace", item => {
            if (item instanceof PackageNode) {
                openInWorkspace(item, ctx);
            }
        })
    );
}
