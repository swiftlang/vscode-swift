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

/**
 * Handle the user requesting to show the vscode-swift documentation.
 */
export async function openDocumentation(): Promise<boolean> {
    return await vscode.env.openExternal(
        vscode.Uri.parse("https://docs.swift.org/vscode/documentation/userdocs")
    );
}
