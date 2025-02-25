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

import { MessageDirection, NotificationType, TextDocumentIdentifier } from "vscode-languageclient";

// We use namespaces to store request information just like vscode-languageclient
/* eslint-disable @typescript-eslint/no-namespace */

export interface DidChangeActiveDocumentParams {
    /**
     * The document that is being displayed in the active editor.
     */
    textDocument?: TextDocumentIdentifier;
}

/**
 * Notify the server that the active document has changed.
 */
export namespace DidChangeActiveDocumentNotification {
    export const method = "window/didChangeActiveDocument" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new NotificationType<DidChangeActiveDocumentParams>(method);
}
