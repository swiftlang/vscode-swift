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
    TextDocumentIdentifier,
    Position,
    MessageDirection,
    RequestType,
} from "vscode-languageclient";

/** Parameters used to make a {@link ConvertDocumentationRequest}. */
export interface ConvertDocumentationParams {
    /**
     * The document to render documentation for.
     */
    textDocument: TextDocumentIdentifier;

    /**
     * The document location at which to lookup symbol information.
     *
     * This parameter is only used in Swift files to determine which symbol to render.
     * The position is ignored for markdown and tutorial documents.
     */
    position: Position;
}

/**
 * The response from a {@link ConvertDocumentationRequest}.
 *
 * The response will either contain a JSON encoded render node or an error.
 */
export type ConvertDocumentationResponse = RenderNodeResponse | ErrorResponse;

interface RenderNodeResponse {
    /**
     * The type of this response: either a RenderNode or error.
     */
    type: "renderNode";

    /**
     * The JSON encoded RenderNode that can be rendered by swift-docc-render.
     */
    renderNode: string;
}

interface ErrorResponse {
    /**
     * The type of this response: either a RenderNode or error.
     */
    type: "error";

    /**
     * The error that occurred.
     */
    error: ConvertDocumentationError;
}

/** An error that can occur when running a {@link ConvertDocumentationRequest}. */
export type ConvertDocumentationError = ErrorWithNoParams | SymbolNotFoundError;

interface ErrorWithNoParams {
    /**
     * The kind of error that occurred.
     */
    kind: "indexNotAvailable" | "noDocumentation";

    /**
     * A human readable error message that can be shown to the user.
     */
    message: string;
}

interface SymbolNotFoundError {
    /**
     * The kind of error that occurred.
     */
    kind: "symbolNotFound";

    /**
     * The name of the symbol that could not be found.
     */
    symbolName: string;

    /**
     * A human readable error message that can be shown to the user.
     */
    message: string;
}

export namespace ConvertDocumentationRequest {
    export const method = "textDocument/convertDocumentation" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType<
        ConvertDocumentationParams,
        ConvertDocumentationResponse,
        never
    >(method);
}
