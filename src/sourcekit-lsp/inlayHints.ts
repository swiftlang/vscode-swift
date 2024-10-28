//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 Apple Inc. and the VS Code Swift project authors
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
import configuration from "../configuration";
import { LanguageClientManager } from "./LanguageClientManager";
import { legacyInlayHintsRequest } from "./lspExtensions";

/** Provide Inlay Hints using sourcekit-lsp */
class SwiftLegacyInlayHintsProvider implements vscode.InlayHintsProvider {
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
            textDocument: this.client.code2ProtocolConverter.asTextDocumentIdentifier(document),
            range: { start: range.start, end: range.end },
        };
        const result = this.client.sendRequest(legacyInlayHintsRequest, params, token);
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
export function activateLegacyInlayHints(client: langclient.LanguageClient): vscode.Disposable {
    const inlayHint = vscode.languages.registerInlayHintsProvider(
        LanguageClientManager.documentSelector,
        new SwiftLegacyInlayHintsProvider(client)
    );

    return inlayHint;
}
