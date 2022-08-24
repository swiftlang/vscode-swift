//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as path from "path";
import contextKeys from "./contextKeys";
import { createSwiftTask } from "./SwiftTaskProvider";
import { WorkspaceContext } from "./WorkspaceContext";

export function setSnippetContextKey(ctx: WorkspaceContext) {
    if (
        ctx.swiftVersion.isLessThan({ major: 5, minor: 7, patch: 0 }) ||
        !ctx.currentFolder ||
        !ctx.currentDocument
    ) {
        contextKeys.fileIsSnippet = false;
        return;
    }

    const filename = ctx.currentDocument.fsPath;
    const snippetsFolder = path.join(ctx.currentFolder.folder.fsPath, "Snippets");
    if (filename.startsWith(snippetsFolder)) {
        contextKeys.fileIsSnippet = true;
    } else {
        contextKeys.fileIsSnippet = false;
    }
    return;
}

export async function runSnippet(ctx: WorkspaceContext) {
    const folderContext = ctx.currentFolder;
    if (!ctx.currentDocument || !folderContext) {
        return;
    }
    const snippetName = path.basename(ctx.currentDocument.fsPath, ".swift");
    const snippetTask = createSwiftTask(["run", snippetName], `Run ${snippetName}`, {
        group: vscode.TaskGroup.Test,
        cwd: folderContext.folder,
        scope: folderContext.workspaceFolder,
        presentationOptions: {
            reveal: vscode.TaskRevealKind.Always,
            panel: vscode.TaskPanelKind.New,
        },
    });

    await vscode.tasks.executeTask(snippetTask);
}
