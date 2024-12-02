//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

// We use namespaces to store request information just like vscode-languageclient
/* eslint-disable @typescript-eslint/no-namespace */

import { MessageDirection, RequestType0 } from "vscode-languageclient";

// Definitions for non-standard requests used by sourcekit-lsp

export * from "./SourceKitLogMessageNotification";
export * from "./PeekDocumentsRequest";
export * from "./GetReferenceDocumentRequest";
export * from "./LegacyInlayHintRequest";
export * from "./GetTestsRequest";
export * from "./SymbolInfoRequest";

/**
 * Re-index all files open in the SourceKit-LSP server.
 *
 * Users should not need to rely on this request. The index should always be updated automatically in the background.
 * Having to invoke this request means there is a bug in SourceKit-LSP's automatic re-indexing. It does, however, offer
 * a workaround to re-index files when such a bug occurs where otherwise there would be no workaround.
 *
 * ### LSP Extension
 *
 * This request is an extension to LSP supported by SourceKit-LSP.
 */
export namespace ReIndexProjectRequest {
    export const method = "workspace/triggerReindex" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType0<void, never>("workspace/triggerReindex");
}
