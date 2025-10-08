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
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { WorkspaceContext } from "../WorkspaceContext";

type SelectFolderQuickPick = AllQuickPickItem | FolderQuickPickItem;

interface AllQuickPickItem extends vscode.QuickPickItem {
    type: "all";
}

interface FolderQuickPickItem extends vscode.QuickPickItem {
    type: "folder";
    folder: FolderContext;
}

/**
 * Select a folder from the workspace context
 * @param ctx
 * @param labels Map "type" to the display label
 * @returns The selected folder or undefined if there was no selection
 */
export async function selectFolder(
    ctx: WorkspaceContext,
    placeHolder: string,
    labels: Record<string, string> = {}
): Promise<FolderContext[]> {
    const quickPickItems: SelectFolderQuickPick[] = ctx.folders.map(folder => ({
        type: "folder",
        folder,
        label: folder.name,
        detail: folder.workspaceFolder.uri.fsPath,
    }));
    quickPickItems.push({ type: "all", label: labels["all"] || "Generate For All Folders" });
    const selection = await vscode.window.showQuickPick(quickPickItems, {
        matchOnDetail: true,
        placeHolder,
    });

    const folders: FolderContext[] = [];
    if (!selection) {
        return folders;
    }

    if (selection.type === "all") {
        folders.push(...ctx.folders);
    } else {
        folders.push(selection.folder);
    }
    return folders;
}
