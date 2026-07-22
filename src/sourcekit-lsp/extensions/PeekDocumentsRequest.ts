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
import {
    DocumentUri,
    Location,
    MessageDirection,
    Position,
    RequestType,
} from "vscode-languageclient";

/** Parameters used to make a {@link PeekDocumentsRequest}. */
export interface PeekDocumentsParams {
    /**
     * The `DocumentUri` of the text document in which to show the "peeked" editor
     */
    uri: DocumentUri;

    /**
     * The `Position` in the given text document in which to show the "peeked editor"
     */
    position: Position;

    /**
     * An array `DocumentUri` or `Location` of the documents to appear inside the "peeked" editor
     */
    locations: DocumentUri[] | Location[];
}

/** Response to indicate the `success` of the {@link PeekDocumentsRequest}. */
export interface PeekDocumentsResponse {
    success: boolean;
}

/**
 * Request from the server to the client to show the given documents in a "peeked" editor **(LSP Extension)**
 *
 * This request is handled by the client to show the given documents in a
 * "peeked" editor (i.e. inline with / inside the editor canvas). This is
 * similar to VS Code's built-in "editor.action.peekLocations" command.
 *
 * - Parameters:
 *   - uri: The {@link DocumentUri} of the text document in which to show the "peeked" editor
 *   - position: The {@link Position} in the given text document in which to show the "peeked editor"
 *   - locations: The {@link DocumentUri} of documents to appear inside the "peeked" editor
 *
 * - Returns: {@link PeekDocumentsResponse} which indicates the `success` of the request.
 *
 * ### LSP Extension
 *
 * This request is an extension to LSP supported by SourceKit-LSP.
 *
 * It requires the experimental client capability `"workspace/peekDocuments"` to use.
 * It also needs the client to handle the request and present the "peeked" editor.
 */
export namespace PeekDocumentsRequest {
    export const method = "workspace/peekDocuments" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType<PeekDocumentsParams, PeekDocumentsResponse, never>(method);
}
