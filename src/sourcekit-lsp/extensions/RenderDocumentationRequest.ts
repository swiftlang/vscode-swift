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

/** Parameters used to make a {@link RenderDocumentationRequest}. */
export interface RenderDocumentationParams {
    /** The document in which to lookup the symbol location. */
    textDocument: TextDocumentIdentifier;

    /** The document location at which to lookup symbol information. */
    position: Position;
}

/** Rendered documentation for a given symbol, such as the response to a {@link RenderDocumentationRequest}. */
export interface RenderedDocumentation {
    content?: string;
}

export namespace RenderDocumentationRequest {
    export const method = "textDocument/renderDocumentation" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType<RenderDocumentationParams, RenderedDocumentation, never>(
        method
    );
}
