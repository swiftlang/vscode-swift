//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";

/**
 * Handle the user requesting to show an educational note.
 *
 * The default behaviour is to open it in a markdown preview to the side.
 */
export async function openEducationalNote(markdownFile: vscode.Uri | undefined): Promise<void> {
    await vscode.commands.executeCommand("markdown.showPreviewToSide", markdownFile);
}
