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
 * Open Package.swift for in focus project
 * @param workspaceContext Workspace context, required to get current project
 */
export async function openPackage(workspaceContext: WorkspaceContext) {
    if (workspaceContext.currentFolder) {
        const packagePath = vscode.Uri.joinPath(
            workspaceContext.currentFolder.folder,
            "Package.swift"
        );
        const document = await vscode.workspace.openTextDocument(packagePath);
        vscode.window.showTextDocument(document);
    }
}
