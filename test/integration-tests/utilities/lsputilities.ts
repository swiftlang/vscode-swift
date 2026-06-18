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

import { SourceKitLanguageClient } from "@src/sourcekit-lsp/client/SourceKitLanguageClient";
import {
    PollIndexRequest,
    WorkspaceSynchronizeRequest,
} from "@src/sourcekit-lsp/extensions/PollIndexRequest";
import { Disposable } from "@src/utilities/Disposable";
import { Version } from "@src/utilities/version";

type Result<T> = SuccessResult<T> | FailureResult;

interface SuccessResult<T> {
    type: "success";
    value: T;
}

interface FailureResult {
    type: "failure";
}

async function poll<T>(predicate: () => Promise<Result<T>>, interval: number = 100): Promise<T> {
    let result = await predicate();
    while (result.type === "failure") {
        await new Promise<void>(resolve => setTimeout(resolve, interval));
        result = await predicate();
    }
    return result.value;
}

/**
 * Wait for the LSP to indicate it is done indexing
 */
export async function waitForIndex(client: SourceKitLanguageClient): Promise<void> {
    const requestType = client.swiftVersion.isGreaterThanOrEqual(new Version(6, 2, 0))
        ? WorkspaceSynchronizeRequest.type
        : PollIndexRequest.type;

    await client.useLanguageClient((c, token) =>
        c.sendRequest(
            requestType,
            requestType.method === WorkspaceSynchronizeRequest.method ? { index: true } : {},
            token
        )
    );
}

export async function waitForClientState(
    client: SourceKitLanguageClient,
    expectedState: langclient.State
): Promise<langclient.State | undefined> {
    if (client.state === expectedState) {
        return;
    }

    const subscriptions: Disposable[] = [];
    await new Promise<void>(resolve => {
        subscriptions.push(
            client.onDidChangeState(event => {
                if (event.newState !== expectedState) {
                    return;
                }
                resolve();
            })
        );
    }).finally(() => subscriptions.forEach(s => s.dispose()));
}

export async function waitForCodeActions(
    client: SourceKitLanguageClient,
    uri: vscode.Uri,
    range: vscode.Range
): Promise<(langclient.CodeAction | langclient.Command)[]> {
    return await poll<(langclient.CodeAction | langclient.Command)[]>(async () => {
        try {
            const response = await client.useLanguageClient((c, token) =>
                c.sendRequest(
                    langclient.CodeActionRequest.type,
                    {
                        context: langclient.CodeActionContext.create([]),
                        textDocument: langclient.TextDocumentIdentifier.create(uri.toString()),
                        range,
                    },
                    token
                )
            );
            if (!response || response.length === 0) {
                return { type: "failure" };
            }
            return { type: "success", value: response };
        } catch (e) {
            return { type: "failure" };
        }
    });
}
