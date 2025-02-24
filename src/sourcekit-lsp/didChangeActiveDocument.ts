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
import { checkExperimentalCapability } from "./LanguageClientManager";
import { DidChangeActiveDocumentNotification } from "./extensions/DidChangeActiveDocumentRequest";

export function activateDidChangeActiveDocument(
    client: langclient.LanguageClient
): vscode.Disposable {
    const disposable = vscode.window.onDidChangeActiveTextEditor(event => {
        if (
            event &&
            checkExperimentalCapability(client, DidChangeActiveDocumentNotification.method, 1)
        ) {
            client.sendNotification(DidChangeActiveDocumentNotification.method, {
                textDocument: client.code2ProtocolConverter.asTextDocumentIdentifier(
                    event.document
                ),
            });
        }
    });

    // Fire an inital notification
    const activeEditor = vscode.window.activeTextEditor;
    if (
        activeEditor &&
        checkExperimentalCapability(client, DidChangeActiveDocumentNotification.method, 1)
    ) {
        client.sendNotification(DidChangeActiveDocumentNotification.method, {
            textDocument: client.code2ProtocolConverter.asTextDocumentIdentifier(
                activeEditor.document
            ),
        });
    }
    return disposable;
}
