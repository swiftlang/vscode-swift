//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
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

export async function showErrorMessageWithLogs(
    ctx: WorkspaceContext,
    message: string
): Promise<void> {
    const selection = await vscode.window.showErrorMessage(message, "Show Logs");
    if (selection !== "Show Logs") {
        return;
    }
    ctx.logger.showOutputChannel();
}
