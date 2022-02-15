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
import * as fs from "fs/promises";
import { FolderEvent, WorkspaceContext } from "./WorkspaceContext";
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
            exe.task.definition.cwd === folderContext.folder.fsPath
    );
    if (index !== -1) {
        return;
    }

    const workspaceContext = folderContext.workspaceContext;
    workspaceContext.outputChannel.logStart("Resolving Dependencies ... ", folderContext.name);
    const task = createSwiftTask(["package", "resolve"], SwiftTaskProvider.resolvePackageName, {
        cwd: folderContext.folder,
        scope: folderContext.workspaceFolder,
        prefix: folderContext.name,
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
            exe.task.definition.cwd === folderContext.folder.fsPath
    );
    if (index !== -1) {
        return;
    }

    const workspaceContext = folderContext.workspaceContext;
    const task = createSwiftTask(["package", "update"], SwiftTaskProvider.updatePackageName, {
        cwd: folderContext.folder,
        scope: folderContext.workspaceFolder,
        prefix: folderContext.name,
        presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
    });
    workspaceContext.outputChannel.logStart("Updating Dependencies ... ", folderContext.name);
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
        cwd: folderContext.folder,
        scope: folderContext.workspaceFolder,
        prefix: folderContext.name,
        presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
        group: vscode.TaskGroup.Clean,
    });
    workspaceContext.outputChannel.logStart("Clean Build ... ", folderContext.name);
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
        cwd: folderContext.folder,
        scope: folderContext.workspaceFolder,
        prefix: folderContext.name,
        presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
        group: vscode.TaskGroup.Clean,
    });
    workspaceContext.outputChannel.logStart("Reset Package ... ", folderContext.name);
    workspaceContext.statusItem.start(task);
    try {
        await executeTaskAndWait(task);
        const resolveTask = createSwiftTask(
            ["package", "resolve"],
            SwiftTaskProvider.resolvePackageName,
            {
                cwd: folderContext.folder,
                scope: folderContext.workspaceFolder,
                prefix: folderContext.name,
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

/**
 * Use local version of package dependency
 *
 * equivalent of `swift package edit --path <localpath> identifier
 * @param identifier Identifier for dependency
 * @param ctx workspace context
 */
async function useLocalDependency(identifier: string, ctx: WorkspaceContext) {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        return;
    }
    vscode.window
        .showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: currentFolder.folder,
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
                currentFolder.name
            );
            const status = `Edit dependency ${identifier} (${currentFolder.name})`;
            ctx.statusItem.start(status);
            try {
                await execSwift(["package", "edit", "--path", value[0].fsPath, identifier], {
                    cwd: currentFolder.folder.fsPath,
                });
                ctx.fireEvent(currentFolder, FolderEvent.resolvedUpdated);
            } catch (error) {
                const execError = error as { stderr: string };
                ctx.outputChannel.log(execError.stderr, currentFolder.name);
                vscode.window.showErrorMessage(`${execError.stderr}`);
            }
            ctx.statusItem.end(status);
        });
}

/**
 * Setup package dependency to be edited
 * @param identifier Identifier of dependency we want to edit
 * @param ctx workspace context
 */
async function editDependency(identifier: string, ctx: WorkspaceContext) {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        return;
    }
    const status = `Edit dependency ${identifier} (${currentFolder.name})`;
    ctx.statusItem.start(status);
    try {
        await execSwift(["package", "edit", identifier], {
            cwd: currentFolder.folder.fsPath,
        });
        ctx.fireEvent(currentFolder, FolderEvent.resolvedUpdated);
        const index = vscode.workspace.workspaceFolders?.length ?? 0;
        vscode.workspace.updateWorkspaceFolders(index, 0, {
            uri: vscode.Uri.file(currentFolder.editedPackageFolder(identifier)),
            name: identifier,
        });
    } catch (error) {
        const execError = error as { stderr: string };
        ctx.outputChannel.log(execError.stderr, currentFolder.name);
        vscode.window.showErrorMessage(`${execError.stderr}`);
    }
    ctx.statusItem.end(status);
}

/**
 * Stop local editing of package dependency
 * @param identifier Identifier of dependency
 * @param ctx workspace context
 */
async function uneditDependency(identifier: string, ctx: WorkspaceContext) {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        return;
    }
    ctx.outputChannel.log(`unedit dependency ${identifier}`, currentFolder.name);
    const status = `Reverting edited dependency ${identifier} (${currentFolder.name})`;
    ctx.statusItem.start(status);
    await uneditFolderDependency(currentFolder, identifier, ctx);
    ctx.statusItem.end(status);
}

async function uneditFolderDependency(
    folder: FolderContext,
    identifier: string,
    ctx: WorkspaceContext,
    args: string[] = []
) {
    try {
        await execSwift(["package", "unedit", ...args, identifier], {
            cwd: folder.folder.fsPath,
        });
        ctx.fireEvent(folder, FolderEvent.resolvedUpdated);
        // find workspace folder, and check folder still exists
        const folderIndex = vscode.workspace.workspaceFolders?.findIndex(
            item => item.name === identifier
        );
        if (folderIndex) {
            try {
                // check folder exists. if error thrown remove folder
                await fs.stat(vscode.workspace.workspaceFolders![folderIndex].uri.fsPath);
            } catch {
                vscode.workspace.updateWorkspaceFolders(folderIndex, 1);
            }
        }
    } catch (error) {
        const execError = error as { stderr: string };
        // if error contains "has uncommited changes" then ask if user wants to force the unedit
        if (execError.stderr.match(/has uncommited changes/)) {
            vscode.window
                .showWarningMessage(
                    `${identifier} has uncommitted changes. Are you sure you want to continue?`,
                    "Yes",
                    "No"
                )
                .then(async result => {
                    if (result === "No") {
                        ctx.outputChannel.log(execError.stderr, folder.name);
                        return;
                    }
                    await uneditFolderDependency(folder, identifier, ctx, ["--force"]);
                });
        } else {
            ctx.outputChannel.log(execError.stderr, folder.name);
            vscode.window.showErrorMessage(`${execError.stderr}`);
        }
    }
}

/**
 * Open local package in workspace
 * @param packageNode PackageNode attached to dependency tree item
 * @param ctx workspace context
 */
async function openInWorkspace(packageNode: PackageNode) {
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
        vscode.commands.registerCommand("swift.useLocalDependency", item => {
            if (item instanceof PackageNode) {
                useLocalDependency(item.name, ctx);
            }
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
                openInWorkspace(item);
            }
        })
    );
}
