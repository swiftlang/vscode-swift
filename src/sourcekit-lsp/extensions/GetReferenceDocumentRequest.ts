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
import { DocumentUri, MessageDirection, RequestType } from "vscode-languageclient";

/** Parameters used to make a {@link GetReferenceDocumentRequest}. */
export interface GetReferenceDocumentParams {
    /** The {@link DocumentUri} of the custom scheme url for which content is required. */
    uri: DocumentUri;
}

/** Response containing `content` of a {@link GetReferenceDocumentRequest}. */
interface GetReferenceDocumentResult {
    content: string;
}

/**
 * Request from the client to the server asking for contents of a URI having a custom scheme **(LSP Extension)**
 * For example: "sourcekit-lsp:"
 *
 * - Parameters:
 *   - uri: The `DocumentUri` of the custom scheme url for which content is required
 *
 * - Returns: `GetReferenceDocumentResponse` which contains the `content` to be displayed.
 *
 * ### LSP Extension
 *
 * This request is an extension to LSP supported by SourceKit-LSP.
 *
 * Enable the experimental client capability `"workspace/getReferenceDocument"` so that the server responds with
 * reference document URLs for certain requests or commands whenever possible.
 */
export namespace GetReferenceDocumentRequest {
    export const method = "workspace/getReferenceDocument" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType<
        GetReferenceDocumentParams,
        GetReferenceDocumentResult,
        never
    >(method);
}
