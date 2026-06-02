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
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

import { SwiftPackage } from "../SwiftPackage";
import { checkExperimentalCapability } from "../sourcekit-lsp/LanguageClientManager";
import { LanguageClientManager } from "../sourcekit-lsp/LanguageClientManager";
import {
    LSPTestItem,
    TextDocumentTestsRequest,
    WorkspaceTestsRequest,
} from "../sourcekit-lsp/extensions";
import * as TestDiscovery from "./TestDiscovery";

/**
 * Used to augment test discovery via `swift test --list-tests`.
 *
 * Uses document symbol request to keep a running copy of all the test methods
 * in a file. When a file is saved it checks to see if any new methods have been
 * added, or if any methods have been removed and edits the test items based on
 * these results.
 */
export class LSPTestDiscovery {
    constructor(private languageClient: LanguageClientManager) {}

    /**
     * Return a list of tests in the supplied document.
     * @param document A document to query
     */
    async getDocumentTests(
        swiftPackage: SwiftPackage,
        document: vscode.Uri
    ): Promise<TestDiscovery.TestClass[]> {
        return await this.languageClient.useLanguageClient(async (client, token) => {
            // Only use the lsp for this request if it supports the
            // textDocument/tests method, and is at least version 2.
            if (checkExperimentalCapability(client, TextDocumentTestsRequest.method, 2)) {
                const testsInDocument = await client.sendRequest(
                    TextDocumentTestsRequest.type,
                    { textDocument: { uri: document.toString() } },
                    token
                );
                return this.transformToTestClass(client, swiftPackage, testsInDocument);
            } else {
                throw new Error(`${TextDocumentTestsRequest.method} requests not supported`);
            }
        });
    }

    /**
     * Return list of workspace tests
     * @param workspaceRoot Root of current workspace folder
     */
    async getWorkspaceTests(swiftPackage: SwiftPackage): Promise<TestDiscovery.TestClass[]> {
        return await this.languageClient.useLanguageClient(async (client, token) => {
            // Only use the lsp for this request if it supports the
            // workspace/tests method, and is at least version 2.
            if (checkExperimentalCapability(client, WorkspaceTestsRequest.method, 2)) {
                const tests = await client.sendRequest(WorkspaceTestsRequest.type, token);
                return await this.transformToTestClass(client, swiftPackage, tests);
            } else {
                throw new Error(`${WorkspaceTestsRequest.method} requests not supported`);
            }
        });
    }

    /**
     * Convert from `LSPTestItem[]` to `TestDiscovery.TestClass[]`,
     * updating the format of the location.
     */
    private async transformToTestClass(
        client: LanguageClient,
        swiftPackage: SwiftPackage,
        input: LSPTestItem[]
    ): Promise<TestDiscovery.TestClass[]> {
        return Promise.all(
            input.map(async item => {
                const location = client.protocol2CodeConverter.asLocation(item.location);
                return {
                    ...item,
                    id: await this.transformId(item, location, swiftPackage),
                    children: await this.transformToTestClass(client, swiftPackage, item.children),
                    location,
                };
            })
        );
    }

    /**
     * If the test is an XCTest, transform the ID provided by the LSP from a
     * swift-testing style ID to one that XCTest can use. This allows the ID to
     * be used to tell to the test runner (xctest or swift-testing) which tests to run.
     */
    private async transformId(
        item: LSPTestItem,
        location: vscode.Location,
        swiftPackage: SwiftPackage
    ): Promise<string> {
        // XCTest: Target.TestClass/testCase
        // swift-testing: TestClass/testCase()
        //                TestClassOrStruct/NestedTestSuite/testCase()
        const target = await swiftPackage.getTarget(location.uri.fsPath);

        // If we're using an older sourcekit-lsp it doesn't prepend the target name
        // to the test item id.
        const id =
            target !== undefined && !item.id.startsWith(`${target.c99name}.`)
                ? `${target.c99name}.${item.id}`
                : item.id;
        return item.style === "XCTest" ? id.replace(/\(\)$/, "") : id;
    }
}
