//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as langclient from "vscode-languageclient/node";
import { TextDocumentContentParams, TextDocumentContentRequest } from "./lspExtensions";

export function activateTextDocumentContent(client: langclient.LanguageClient): vscode.Disposable {
    const textDocumentContent = vscode.workspace.registerTextDocumentContentProvider(
        "sourcekit-lsp",
        {
            provideTextDocumentContent: async (uri, token) => {
                const params: TextDocumentContentParams = {
                    uri: client.code2ProtocolConverter.asUri(uri),
                };

                const result = await client.sendRequest(TextDocumentContentRequest, params, token);

                if (result) {
                    return result.text;
                } else {
                    return "Unable to retrieve reference document";
                }
            },
        }
    );

    return textDocumentContent;
}
