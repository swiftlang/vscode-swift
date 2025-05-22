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

/**
 * Uses the workspace's comment completion provider to insert a function comment
 * at the active line.
 * @param workspaceContext Workspace context, required to get comment completion provider
 */
export async function insertFunctionComment(workspaceContext: WorkspaceContext) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }
    const line = activeEditor.selection.active.line;
    await workspaceContext.commentCompletionProvider.insert(activeEditor, line);
}
