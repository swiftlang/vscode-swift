//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import { makeDebugConfigurations } from "../debugger/launch";
import { FolderContext } from "../FolderContext";
import { WorkspaceContext } from "../WorkspaceContext";
import * as vscode from "vscode";

export async function generateLaunchConfigurations(ctx: WorkspaceContext): Promise<boolean> {
    if (ctx.folders.length === 0) {
        return false;
    }

    if (ctx.folders.length === 1) {
        return await makeDebugConfigurations(ctx.folders[0], { force: true, yes: true });
    }

    const quickPickItems: SelectFolderQuickPick[] = ctx.folders.map(folder => ({
        type: "folder",
        folder,
        label: folder.name,
        detail: folder.workspaceFolder.uri.fsPath,
    }));
    quickPickItems.push({ type: "all", label: "Generate For All Folders" });
    const selection = await vscode.window.showQuickPick(quickPickItems, {
        matchOnDetail: true,
        placeHolder: "Select a folder to generate launch configurations for",
    });

    if (!selection) {
        return false;
    }

    const foldersToUpdate: FolderContext[] = [];
    if (selection.type === "all") {
        foldersToUpdate.push(...ctx.folders);
    } else {
        foldersToUpdate.push(selection.folder);
    }

    return (
        await Promise.all(
            foldersToUpdate.map(folder =>
                makeDebugConfigurations(folder, { force: true, yes: true })
            )
        )
    ).reduceRight((prev, curr) => prev || curr);
}

type SelectFolderQuickPick = AllQuickPickItem | FolderQuickPickItem;

interface AllQuickPickItem extends vscode.QuickPickItem {
    type: "all";
}

interface FolderQuickPickItem extends vscode.QuickPickItem {
    type: "folder";
    folder: FolderContext;
}
