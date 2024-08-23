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

import * as ls from "vscode-languageserver-protocol";
import * as langclient from "vscode-languageclient/node";
import * as vscode from "vscode";

// Definitions for non-standard requests used by sourcekit-lsp

// Peek Documents
export interface PeekDocumentsParams {
    /**
     * The `DocumentUri` of the text document in which to show the "peeked" editor
     */
    uri: langclient.DocumentUri;

    /**
     * The `Position` in the given text document in which to show the "peeked editor"
     */
    position: vscode.Position;

    /**
     * An array `DocumentUri` of the documents to appear inside the "peeked" editor
     */
    locations: langclient.DocumentUri[];
}

/**
 * Response to indicate the `success` of the `PeekDocumentsRequest`
 */
export interface PeekDocumentsResult {
    success: boolean;
}

/**
 * Request from the server to the client to show the given documents in a "peeked" editor.
 *
 * This request is handled by the client to show the given documents in a "peeked" editor (i.e. inline with / inside the editor canvas).
 *
 * It requires the experimental client capability `"workspace/peekDocuments"` to use.
 */
export const PeekDocumentsRequest = new langclient.RequestType<
    PeekDocumentsParams,
    PeekDocumentsResult,
    unknown
>("workspace/peekDocuments");

// Get Reference Document
export interface LegacyGetReferenceDocumentParams {
    /**
     * The `DocumentUri` of the custom scheme url for which content is required
     */
    uri: langclient.DocumentUri;
}

/**
 * Response containing `content` of `GetReferenceDocumentRequest`
 */
export interface LegacyGetReferenceDocumentResult {
    content: string;
}

/**
 * Request from the client to the server asking for contents of a URI having a custom scheme
 * For example: "sourcekit-lsp:"
 */
export const LegacyGetReferenceDocumentRequest = new langclient.RequestType<
    LegacyGetReferenceDocumentParams,
    LegacyGetReferenceDocumentResult,
    unknown
>("workspace/getReferenceDocument");

// Inlay Hints (pre Swift 5.6)
export interface LegacyInlayHintsParams {
    /**
     * The text document.
     */
    textDocument: langclient.TextDocumentIdentifier;

    /**
     * If set, the reange for which inlay hints are
     * requested. If unset, hints for the entire document
     * are returned.
     */
    range?: langclient.Range;

    /**
     * The categories of inlay hints that are requested.
     * If unset, all categories are returned.
     */
    only?: string[];
}

export interface LegacyInlayHint {
    /**
     * The position within the code that this hint is
     * attached to.
     */
    position: langclient.Position;

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

export const legacyInlayHintsRequest = new langclient.RequestType<
    LegacyInlayHintsParams,
    LegacyInlayHint[],
    unknown
>("sourcekit-lsp/inlayHints");

// Test styles where test-target represents a test target that contains tests
export type TestStyle = "XCTest" | "swift-testing" | "test-target";

// Listing tests
export interface LSPTestItem {
    /**
     * This identifier uniquely identifies the test case or test suite. It can be used to run an individual test (suite).
     */
    id: string;

    /**
     * Display name describing the test.
     */
    label: string;

    /**
     * Optional description that appears next to the label.
     */
    description?: string;

    /**
     * A string that should be used when comparing this item with other items.
     *
     * When `undefined` the `label` is used.
     */
    sortText?: string;

    /**
     *  Whether the test is disabled.
     */
    disabled: boolean;

    /**
     * The type of test, eg. the testing framework that was used to declare the test.
     */
    style: TestStyle;

    /**
     * The location of the test item in the source code.
     */
    location: ls.Location;

    /**
     * The children of this test item.
     *
     * For a test suite, this may contain the individual test cases or nested suites.
     */
    children: LSPTestItem[];

    /**
     * Tags associated with this test item.
     */
    tags: { id: string }[];
}

export const workspaceTestsRequest = new langclient.RequestType<
    Record<string, never>,
    LSPTestItem[],
    unknown
>("workspace/tests");

interface DocumentTestsParams {
    textDocument: {
        uri: ls.URI;
    };
}

export const textDocumentTestsRequest = new langclient.RequestType<
    DocumentTestsParams,
    LSPTestItem[],
    unknown
>("textDocument/tests");

export const reindexProjectRequest = new langclient.RequestType<null, unknown, unknown>(
    "workspace/triggerReindex"
);
