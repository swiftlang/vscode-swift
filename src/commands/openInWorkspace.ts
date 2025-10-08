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

import { PackageNode } from "../ui/ProjectPanelProvider";

/**
 * Open a local package in workspace
 * @param packageNode PackageNode attached to dependency tree item
 */
export async function openInWorkspace(packageNode: PackageNode) {
    const index = vscode.workspace.workspaceFolders?.length ?? 0;
    vscode.workspace.updateWorkspaceFolders(index, 0, {
        uri: vscode.Uri.file(packageNode.path),
        name: packageNode.name,
    });
}
