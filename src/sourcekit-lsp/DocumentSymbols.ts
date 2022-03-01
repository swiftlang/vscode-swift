//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as langclient from "vscode-languageclient/node";
import { LanguageClientManager } from "./LanguageClientManager";

export async function getFileSymbols(
    uri: vscode.Uri,
    languageClientManager: LanguageClientManager
): Promise<langclient.DocumentSymbol[] | undefined> {
    return await languageClientManager.useLanguageClient(async (client, cancellationToken) => {
        const params = {
            textDocument: langclient.TextDocumentIdentifier.create(uri.toString(true)),
        };
        const response = await client.sendRequest(
            langclient.DocumentSymbolRequest.type,
            params,
            cancellationToken
        );
        if (!response) {
            return undefined;
        }
        if (response.length === 0) {
            return [];
        }
        if (langclient.DocumentSymbol.is(response[0])) {
            return response.map(item => item as langclient.DocumentSymbol);
        }
    });
}
