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
import { Version } from "../../../src/utilities/version";

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

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace PollIndexRequest {
    export const method = "workspace/_pollIndex" as const;
    export const messageDirection: langclient.MessageDirection =
        langclient.MessageDirection.clientToServer;
    export const type = new langclient.RequestType<object, object, never>(method);
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace WorkspaceSynchronizeRequest {
    export const method = "workspace/_synchronize" as const;
    export const messageDirection: langclient.MessageDirection =
        langclient.MessageDirection.clientToServer;
    export const type = new langclient.RequestType<object, object, never>(method);
}

export async function waitForIndex(languageClientManager: LanguageClientManager): Promise<void> {
    if (
        languageClientManager.workspaceContext.swiftVersion.isGreaterThanOrEqual(
            new Version(6, 2, 0)
        )
    ) {
        await languageClientManager.useLanguageClient(async (client, token) =>
            client.sendRequest(
                WorkspaceSynchronizeRequest.type,
                {
                    index: true,
                },
                token
            )
        );
    } else {
        await languageClientManager.useLanguageClient(async (client, token) =>
            client.sendRequest(PollIndexRequest.type, {}, token)
        );
    }
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
