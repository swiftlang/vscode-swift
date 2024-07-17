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
import { PeekDocumentsParams, PeekDocumentsRequest } from "./lspExtensions";

export function activatePeekDocuments(client: langclient.LanguageClient): vscode.Disposable {
    const peekDocuments = client.onRequest(
        PeekDocumentsRequest.method,
        async (params: PeekDocumentsParams) => {
            const locations = params.locations.map(uri => {
                const url = new URL(uri);
                const location = new vscode.Location(
                    vscode.Uri.parse(url.href, true),
                    new vscode.Position(0, 0)
                );

                return location;
            });

            await vscode.commands.executeCommand(
                "editor.action.peekLocations",
                vscode.Uri.from({
                    scheme: "file",
                    path: new URL(params.uri).pathname,
                }),
                new vscode.Position(params.position.line, params.position.character),
                locations,
                "peek"
            );

            return { success: true };
        }
    );

    return peekDocuments;
}
