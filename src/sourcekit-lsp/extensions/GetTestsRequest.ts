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
    Location,
    TextDocumentIdentifier,
    MessageDirection,
    RequestType0,
    RequestType,
} from "vscode-languageclient";

/** Test styles where test-target represents a test target that contains tests. */
export type TestStyle = "XCTest" | "swift-testing" | "test-target";

/** Represents a single test returned from a {@link WorkspaceTestsRequest} or {@link TextDocumentTestsRequest}. */
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
    location: Location;

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

/**
 * A request that returns symbols for all the test classes and test methods within the current workspace.
 *
 * ### LSP Extension
 *
 * This request is an extension to LSP supported by SourceKit-LSP.
 *
 * It requires the experimental client capability `"workspace/tests"` to use.
 */
export namespace WorkspaceTestsRequest {
    export const method = "workspace/tests" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType0<LSPTestItem[], never>(method);
}

/** Parameters used to make a {@link TextDocumentTestsRequest}. */
export interface TextDocumentTestsParams {
    textDocument: TextDocumentIdentifier;
}

/**
 * A request that returns symbols for all the test classes and test methods within a file.
 *
 * ### LSP Extension
 *
 * This request is an extension to LSP supported by SourceKit-LSP.
 *
 * It requires the experimental client capability `"textDocument/tests"` to use.
 */
export namespace TextDocumentTestsRequest {
    export const method = "textDocument/tests" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType<TextDocumentTestsParams, LSPTestItem[], never>(method);
}
