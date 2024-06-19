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

import * as assert from "assert";
import * as vscode from "vscode";
import * as ls from "vscode-languageserver-protocol";
import * as p2c from "vscode-languageclient/lib/common/protocolConverter";
import { beforeEach } from "mocha";
import { InitializeResult, RequestType } from "vscode-languageclient";
import { LSPTestDiscovery } from "../../../src/TestExplorer/LSPTestDiscovery";
import { SwiftPackage, Target, TargetType } from "../../../src/SwiftPackage";
import { TestClass } from "../../../src/TestExplorer/TestDiscovery";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import {
    LSPTestItem,
    textDocumentTestsRequest,
    workspaceTestsRequest,
} from "../../../src/sourcekit-lsp/lspExtensions";

class TestLanguageClient {
    private responses = new Map<string, unknown>();
    private responseVersions = new Map<string, number>();

    setResponse<P, R, E>(type: RequestType<P, R, E>, response: R) {
        this.responses.set(type.method, response);
    }

    setResponseVersion<P, R, E>(type: RequestType<P, R, E>, version: number) {
        this.responseVersions.set(type.method, version);
    }

    get initializeResult(): InitializeResult | undefined {
        return {
            capabilities: {
                experimental: {
                    "textDocument/tests": {
                        version: this.responseVersions.get("textDocument/tests") ?? 999,
                    },
                    "workspace/tests": {
                        version: this.responseVersions.get("workspace/tests") ?? 999,
                    },
                },
            },
        };
    }
    get protocol2CodeConverter(): p2c.Converter {
        return p2c.createConverter(undefined, true, true);
    }

    sendRequest<P, R, E>(type: RequestType<P, R, E>): Promise<R> {
        const response = this.responses.get(type.method) as R | undefined;
        return response ? Promise.resolve(response) : Promise.reject("Method not implemented");
    }
}

suite("LSPTestDiscovery Suite", () => {
    let client: TestLanguageClient;
    let discoverer: LSPTestDiscovery;
    let pkg: SwiftPackage;
    const file = vscode.Uri.file("file:///some/file.swift");

    beforeEach(async () => {
        pkg = await SwiftPackage.create(file, await SwiftToolchain.create());
        client = new TestLanguageClient();
        discoverer = new LSPTestDiscovery({
            useLanguageClient(process) {
                return process(client, new vscode.CancellationTokenSource().token);
            },
        });
    });

    suite("Empty resposes", () => {
        test(textDocumentTestsRequest.method, async () => {
            client.setResponse(textDocumentTestsRequest, []);

            const testClasses = await discoverer.getDocumentTests(pkg, file);

            assert.deepStrictEqual(testClasses, []);
        });

        test(workspaceTestsRequest.method, async () => {
            client.setResponse(workspaceTestsRequest, []);

            const testClasses = await discoverer.getWorkspaceTests(pkg);

            assert.deepStrictEqual(testClasses, []);
        });
    });

    suite("Unsupported LSP version", () => {
        test(textDocumentTestsRequest.method, async () => {
            client.setResponseVersion(textDocumentTestsRequest, 0);

            await assert.rejects(() => discoverer.getDocumentTests(pkg, file));
        });

        test(workspaceTestsRequest.method, async () => {
            client.setResponseVersion(workspaceTestsRequest, 0);

            await assert.rejects(() => discoverer.getWorkspaceTests(pkg));
        });

        test("missing experimental capabiltity", async () => {
            Object.defineProperty(client, "initializeResult", {
                get: () => ({ capabilities: {} }),
            });

            await assert.rejects(() => discoverer.getWorkspaceTests(pkg));
        });

        test("missing specific capability", async () => {
            Object.defineProperty(client, "initializeResult", {
                get: () => ({ capabilities: { experimental: {} } }),
            });

            await assert.rejects(() => discoverer.getWorkspaceTests(pkg));
        });
    });

    suite("Non empty responses", () => {
        let items: LSPTestItem[];
        let expected: TestClass[];

        beforeEach(() => {
            items = [
                {
                    id: "topLevelTest()",
                    label: "topLevelTest()",
                    disabled: false,
                    style: "swift-testing",
                    tags: [],
                    location: ls.Location.create(
                        file.fsPath,
                        ls.Range.create(ls.Position.create(1, 0), ls.Position.create(2, 0))
                    ),
                    children: [],
                },
            ];

            expected = items.map(item => ({
                ...item,
                location: client.protocol2CodeConverter.asLocation(item.location),
                children: [],
            }));
        });

        test(textDocumentTestsRequest.method, async () => {
            client.setResponse(textDocumentTestsRequest, items);

            const testClasses = await discoverer.getDocumentTests(pkg, file);

            assert.deepStrictEqual(testClasses, expected);
        });

        test(workspaceTestsRequest.method, async () => {
            client.setResponse(workspaceTestsRequest, items);

            const testClasses = await discoverer.getWorkspaceTests(pkg);

            assert.deepStrictEqual(testClasses, expected);
        });

        test("converts LSP XCTest IDs", async () => {
            items = items.map(item => ({ ...item, style: "XCTest" }));
            expected = expected.map(item => ({
                ...item,
                id: "topLevelTest",
                style: "XCTest",
            }));

            client.setResponse(workspaceTestsRequest, items);

            const testClasses = await discoverer.getWorkspaceTests(pkg);

            assert.deepStrictEqual(testClasses, expected);
        });

        test("Prepends test target to ID", async () => {
            const testTargetName = "TestTargetC99Name";
            expected = expected.map(item => ({
                ...item,
                id: `${testTargetName}.topLevelTest()`,
            }));

            client.setResponse(workspaceTestsRequest, items);

            const target: Target = {
                c99name: testTargetName,
                name: testTargetName,
                path: file.fsPath,
                type: TargetType.test,
                sources: [],
            };
            pkg.getTargets = () => [target];
            pkg.getTarget = () => target;

            const testClasses = await discoverer.getWorkspaceTests(pkg);

            assert.deepStrictEqual(
                testClasses.map(({ id }) => id),
                expected.map(({ id }) => id)
            );
        });
    });
});
