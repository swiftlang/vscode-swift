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
import configuration from "../configuration";
import { LanguageClientManager } from "./LanguageClientManager";
import { inlayHintsRequest } from "./lspExtensions";

/** Provide Inlay Hints using sourcekit-lsp */
class SwiftInlayHintsProvider implements vscode.InlayHintsProvider {
    onDidChangeInlayHints?: vscode.Event<void> | undefined;

    constructor(private client: langclient.LanguageClient) {}

    provideInlayHints(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlayHint[]> {
        // check configuration to see if inlay hints should be displayed
        if (!configuration.lsp.inlayHintsEnabled) {
            return null;
        }
        const params = {
            textDocument: langclient.TextDocumentIdentifier.create(document.uri.toString(true)),
            range: { start: range.start, end: range.end },
        };
        const result = this.client.sendRequest(inlayHintsRequest, params, token);
        return result.then(
            hints => {
                return hints.map(hint => {
                    let label = hint.label;
                    let kind: vscode.InlayHintKind | undefined;
                    switch (hint.category) {
                        case "type":
                            kind = vscode.InlayHintKind.Type;
                            label = `: ${label}`;
                            break;
                        case "parameter":
                            kind = vscode.InlayHintKind.Parameter;
                            break;
                    }
                    return {
                        label: label,
                        position: hint.position,
                        kind: kind,
                        paddingLeft: true,
                    };
                });
            },
            reason => reason
        );
    }
}

/** activate the inlay hints */
export function activateInlayHints(client: langclient.LanguageClient): vscode.Disposable {
    const inlayHint = vscode.languages.registerInlayHintsProvider(
        LanguageClientManager.documentSelector,
        new SwiftInlayHintsProvider(client)
    );

    return inlayHint;
}
