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
import { checkExperimentalCapability } from "./LanguageClientManager";
import { DidChangeActiveDocumentNotification } from "./extensions/DidChangeActiveDocumentRequest";

/**
 * Monitors the active document and notifies the LSP whenever it changes.
 * Only sends notifications for documents that produce `textDocument/didOpen`/`textDocument/didClose`
 * requests to the client.
 */
export class LSPActiveDocumentManager {
    private openDocuments = new Set<vscode.Uri>();
    private lastActiveDocument: langclient.TextDocumentIdentifier | null = null;

    // These are LSP middleware functions that listen for document open and close events.
    public async didOpen(
        document: vscode.TextDocument,
        next: (data: vscode.TextDocument) => Promise<void>
    ) {
        this.openDocuments.add(document.uri);
        await next(document);
    }

    public async didClose(
        document: vscode.TextDocument,
        next: (data: vscode.TextDocument) => Promise<void>
    ) {
        this.openDocuments.add(document.uri);
        await next(document);
    }

    public activateDidChangeActiveDocument(client: langclient.LanguageClient): vscode.Disposable {
        // Fire an inital notification on startup if there is an open document.
        this.sendNotification(client, vscode.window.activeTextEditor?.document);

        // Listen for the active editor to change and send a notification.
        return vscode.window.onDidChangeActiveTextEditor(event => {
            this.sendNotification(client, event?.document);
        });
    }

    private sendNotification(
        client: langclient.LanguageClient,
        document: vscode.TextDocument | undefined
    ) {
        if (checkExperimentalCapability(client, DidChangeActiveDocumentNotification.method, 1)) {
            const textDocument =
                document && this.openDocuments.has(document.uri)
                    ? client.code2ProtocolConverter.asTextDocumentIdentifier(document)
                    : null;

            // Avoid sending multiple identical notifications in a row.
            if (textDocument !== this.lastActiveDocument) {
                void client.sendNotification(DidChangeActiveDocumentNotification.method, {
                    textDocument: textDocument,
                });
            }
            this.lastActiveDocument = textDocument;
        }
    }
}
