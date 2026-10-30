//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
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
    Definition,
    DefinitionLink,
    MessageDirection,
    RequestType,
    TextDocumentIdentifier,
} from "vscode-languageclient";

/** Parameters used to make a {@link DocCSymbolLinkDefinitionRequest}. */
interface DocCSymbolLinkDefinitionParams {
    /**
     * The document the symbol link was clicked in.
     *
     * This is used to identify the workspace to resolve the link in.
     */
    textDocument: TextDocumentIdentifier;

    /**
     * The DocC symbol link to resolve.
     */
    symbolLink: string;
}

/**
 * The response from a {@link DocCSymbolLinkDefinitionRequest}.
 *
 * This is `null` if the symbol link could not be parsed or resolved.
 */
export type DocCSymbolLinkDefinitionResponse = Definition | DefinitionLink[] | null;

export namespace DocCSymbolLinkDefinitionRequest {
    export const method = "sourcekit/textDocument/doccSymbolLinkDefinition" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType<
        DocCSymbolLinkDefinitionParams,
        DocCSymbolLinkDefinitionResponse,
        never
    >(method);
}
