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
import * as TestDiscovery from "./TestDiscovery";
import {
    LSPTestItem,
    textDocumentTestsRequest,
    workspaceTestsRequest,
} from "../sourcekit-lsp/lspExtensions";
import { LanguageClientManager } from "../sourcekit-lsp/LanguageClientManager";
import { LanguageClient } from "vscode-languageclient/node";
import { SwiftPackage, TargetType } from "../SwiftPackage";

/**
 * Used to augment test discovery via `swift test --list-tests`.
 *
 * Uses document symbol request to keep a running copy of all the test methods
 * in a file. When a file is saved it checks to see if any new methods have been
 * added, or if any methods have been removed and edits the test items based on
 * these results.
 */
export class LSPTestDiscovery {
    private capCache = new Map<string, boolean>();

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
            if (this.checkExperimentalCapability(client, textDocumentTestsRequest.method, 2)) {
                const testsInDocument = await client.sendRequest(
                    textDocumentTestsRequest,
                    { textDocument: { uri: document.toString() } },
                    token
                );
                return this.transformToTestClass(client, swiftPackage, testsInDocument);
            } else {
                throw new Error(`${textDocumentTestsRequest.method} requests not supported`);
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
            if (this.checkExperimentalCapability(client, workspaceTestsRequest.method, 2)) {
                const tests = await client.sendRequest(workspaceTestsRequest, {}, token);
                return this.transformToTestClass(client, swiftPackage, tests);
            } else {
                throw new Error(`${workspaceTestsRequest.method} requests not supported`);
            }
        });
    }

    /**
     * Returns `true` if the LSP supports the supplied `method` at or
     * above the supplied `minVersion`.
     */
    private checkExperimentalCapability(
        client: LanguageClient,
        method: string,
        minVersion: number
    ) {
        const capKey = `${method}:${minVersion}`;
        const cachedCap = this.capCache.get(capKey);
        if (cachedCap !== undefined) {
            return cachedCap;
        }

        const experimentalCapability = client.initializeResult?.capabilities.experimental;
        if (!experimentalCapability) {
            throw new Error(`${method} requests not supported`);
        }
        const targetCapability = experimentalCapability[method];
        const canUse = (targetCapability?.version ?? -1) >= minVersion;
        this.capCache.set(capKey, canUse);
        return canUse;
    }

    /**
     * Convert from `LSPTestItem[]` to `TestDiscovery.TestClass[]`,
     * updating the format of the location.
     */
    private transformToTestClass(
        client: LanguageClient,
        swiftPackage: SwiftPackage,
        input: LSPTestItem[]
    ): TestDiscovery.TestClass[] {
        return input.map(item => {
            const location = client.protocol2CodeConverter.asLocation(item.location);
            const id = this.transformId(item, location, swiftPackage);
            return {
                ...item,
                id: id,
                location: location,
                children: this.transformToTestClass(client, swiftPackage, item.children),
            };
        });
    }

    /**
     * If the test is an XCTest, transform the ID provided by the LSP from a
     * swift-testing style ID to one that XCTest can use. This allows the ID to
     * be used to tell to the test runner (xctest or swift-testing) which tests to run.
     */
    private transformId(
        item: LSPTestItem,
        location: vscode.Location,
        swiftPackage: SwiftPackage
    ): string {
        // XCTest: Target.TestClass/testCase
        // swift-testing: TestClass/testCase()
        //                TestClassOrStruct/NestedTestSuite/testCase()
        const target = swiftPackage
            .getTargets(TargetType.test)
            .find(target => swiftPackage.getTarget(location.uri.fsPath) === target);

        const id = target !== undefined ? `${target.c99name}.${item.id}` : item.id;
        if (item.style === "XCTest") {
            return id.replace(/\(\)$/, "");
        } else {
            return id;
        }
    }
}
