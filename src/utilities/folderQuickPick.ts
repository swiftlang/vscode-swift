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
import { WorkspaceContext } from "../WorkspaceContext";
import { FolderContext } from "../FolderContext";

export default async function showFolderSelectionQuickPick(
    ctx: WorkspaceContext,
    placeHolder: string = "Select a folder"
): Promise<FolderContext | undefined> {
    const folders: vscode.QuickPickItem[] = ctx.folders.map(folder => ({
        label: folder.name,
        description: folder.folder.fsPath.toString(),
    }));
    const selected = await vscode.window.showQuickPick(folders, {
        title: "Folder Selection",
        placeHolder: placeHolder,
        canPickMany: false,
    });

    if (!selected) {
        return undefined;
    }

    return ctx.folders.find(folder => folder.name === selected.label);
}
