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
    MessageDirection,
    Position,
    RequestType,
    TextDocumentIdentifier,
} from "vscode-languageclient";

/** Parameters used to make a {@link DocCDocumentationRequest}. */
interface DocCDocumentationParams {
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
 * The response from a {@link DocCDocumentationRequest} containing a single RenderNode
 * that can be displayed in an editor via `swiftlang/swift-docc-render`
 */
export interface DocCDocumentationResponse {
    renderNode: string;
}

export namespace DocCDocumentationRequest {
    export const method = "textDocument/doccDocumentation" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType<DocCDocumentationParams, DocCDocumentationResponse, never>(
        method
    );
}
