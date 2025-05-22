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
import * as fs from "fs/promises";
import { FolderOperation, WorkspaceContext } from "../../WorkspaceContext";
import { SwiftExecOperation } from "../../tasks/TaskQueue";
import { FolderContext } from "../../FolderContext";

/**
 * Stop local editing of package dependency
 * @param identifier Identifier of dependency
 * @param ctx workspace context
 */
export async function uneditDependency(identifier: string, ctx: WorkspaceContext) {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        ctx.outputChannel.log("currentFolder is not set.");
        return false;
    }
    ctx.outputChannel.log(`unedit dependency ${identifier}`, currentFolder.name);
    const status = `Reverting edited dependency ${identifier} (${currentFolder.name})`;
    return await ctx.statusItem.showStatusWhileRunning(status, async () => {
        return await uneditFolderDependency(currentFolder, identifier, ctx);
    });
}

async function uneditFolderDependency(
    folder: FolderContext,
    identifier: string,
    ctx: WorkspaceContext,
    args: string[] = []
) {
    try {
        const uneditOperation = new SwiftExecOperation(
            folder.toolchain.buildFlags.withAdditionalFlags([
                "package",
                "unedit",
                ...args,
                identifier,
            ]),
            folder,
            `Finish editing ${identifier}`,
            { showStatusItem: true, checkAlreadyRunning: false, log: "Unedit" },
            () => {
                // do nothing. Just want to run the process on the Task queue to ensure it
                // doesn't clash with another swifr process
            }
        );
        await folder.taskQueue.queueOperation(uneditOperation);

        await ctx.fireEvent(folder, FolderOperation.resolvedUpdated);
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
        return true;
    } catch (error) {
        const execError = error as { stderr: string };
        // if error contains "has uncommited changes" then ask if user wants to force the unedit
        if (execError.stderr.match(/has uncommited changes/)) {
            const result = await vscode.window.showWarningMessage(
                `${identifier} has uncommitted changes. Are you sure you want to continue?`,
                "Yes",
                "No"
            );

            if (result === "No") {
                ctx.outputChannel.log(execError.stderr, folder.name);
                return false;
            }
            await uneditFolderDependency(folder, identifier, ctx, ["--force"]);
        } else {
            ctx.outputChannel.log(execError.stderr, folder.name);
            vscode.window.showErrorMessage(`${execError.stderr}`);
        }
        return false;
    }
}
