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
import * as langclient from "vscode-languageclient/node";
import { LanguageClientManager } from "../../../src/sourcekit-lsp/LanguageClientManager";

export async function waitForClient<Result>(
    languageClientManager: LanguageClientManager,
    getResult: (
        c: langclient.LanguageClient,
        token: langclient.CancellationToken
    ) => Promise<Result>,
    match: (r: Result | undefined) => boolean
): Promise<Result | undefined> {
    let result: Result | undefined = undefined;
    while (!match(result)) {
        result = await languageClientManager.useLanguageClient<Result>(getResult);
        console.warn("Language client is not ready yet. Retrying in 100 ms...");
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return result;
}

export async function waitForClientState(
    languageClientManager: LanguageClientManager,
    expectedState: langclient.State
): Promise<langclient.State | undefined> {
    return await waitForClient(
        languageClientManager,
        async c => c.state,
        s => s === expectedState
    );
}

export async function waitForSymbols(
    languageClientManager: LanguageClientManager,
    uri: vscode.Uri
): Promise<langclient.DocumentSymbol[] | langclient.SymbolInformation[]> {
    let symbols: langclient.DocumentSymbol[] | langclient.SymbolInformation[] = [];
    while (symbols?.length === 0) {
        symbols =
            (await languageClientManager.useLanguageClient(async (client, token) =>
                client.sendRequest(
                    langclient.DocumentSymbolRequest.type,
                    { textDocument: langclient.TextDocumentIdentifier.create(uri.toString()) },
                    token
                )
            )) || [];
        console.warn("Language client is not ready yet. Retrying in 100 ms...");
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return (
        (await waitForClient(
            languageClientManager,
            async (client, token) =>
                client.sendRequest(
                    langclient.DocumentSymbolRequest.type,
                    { textDocument: langclient.TextDocumentIdentifier.create(uri.toString()) },
                    token
                ),
            s => (s || []).length > 0
        )) || []
    );
}

export async function waitForCodeActions(
    languageClientManager: LanguageClientManager,
    uri: vscode.Uri,
    range: vscode.Range
): Promise<(langclient.CodeAction | langclient.Command)[]> {
    return (
        (await waitForClient(
            languageClientManager,
            async (client, token) => {
                try {
                    return client.sendRequest(
                        langclient.CodeActionRequest.type,
                        {
                            context: langclient.CodeActionContext.create([]),
                            textDocument: langclient.TextDocumentIdentifier.create(uri.toString()),
                            range,
                        },
                        token
                    );
                } catch (e) {
                    // Ignore
                }
            },
            s => (s || []).length > 0
        )) || []
    );
}
