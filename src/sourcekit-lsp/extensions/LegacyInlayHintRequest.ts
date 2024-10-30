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
    Range,
    Position,
    MessageDirection,
    RequestType,
} from "vscode-languageclient";

/** Parameters used to make a {@link LegacyInlayHintRequest}. */
export interface LegacyInlayHintsParams {
    /**
     * The text document.
     */
    textDocument: TextDocumentIdentifier;

    /**
     * If set, the reange for which inlay hints are
     * requested. If unset, hints for the entire document
     * are returned.
     */
    range?: Range;

    /**
     * The categories of inlay hints that are requested.
     * If unset, all categories are returned.
     */
    only?: string[];
}

/** Inlay Hint (pre Swift 5.6) */
export interface LegacyInlayHint {
    /**
     * The position within the code that this hint is
     * attached to.
     */
    position: Position;

    /**
     * The hint's kind, used for more flexible client-side
     * styling of the hint.
     */
    category?: string;

    /**
     * The hint's rendered label.
     */
    label: string;
}

/** Inlay Hints (pre Swift 5.6) */
export namespace LegacyInlayHintRequest {
    export const method = "sourcekit-lsp/inlayHints" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType<LegacyInlayHintsParams, LegacyInlayHint[], never>(method);
}
