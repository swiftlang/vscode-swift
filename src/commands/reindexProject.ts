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
import { reindexProjectRequest } from "../sourcekit-lsp/lspExtensions";

/**
 * Request that the SourceKit-LSP server reindexes the workspace.
 */
export function reindexProject(workspaceContext: WorkspaceContext): Promise<unknown> {
    return workspaceContext.languageClientManager.useLanguageClient(async (client, token) => {
        try {
            await client.sendRequest(reindexProjectRequest, {}, token);
            const result = await vscode.window.showWarningMessage(
                "Re-indexing a project should never be necessary and indicates a bug in SourceKit-LSP. Please file an issue describing which symbol was out-of-date and how you got into the state.",
                "Report Issue",
                "Close"
            );
            if (result === "Report Issue") {
                vscode.commands.executeCommand(
                    "vscode.open",
                    vscode.Uri.parse(
                        "https://github.com/swiftlang/sourcekit-lsp/issues/new?template=BUG_REPORT.yml&title=Symbol%20Indexing%20Issue"
                    )
                );
            }
        } catch (err) {
            const error = err as { code: number; message: string };
            // methodNotFound, version of sourcekit-lsp is likely too old.
            if (error.code === -32601) {
                vscode.window.showWarningMessage(
                    "The installed version of SourceKit-LSP does not support background indexing."
                );
            } else {
                vscode.window.showWarningMessage(error.message);
            }
        }
    });
}
