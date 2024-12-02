//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
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
import { beforeEach } from "mocha";
import {
    LanguageClient,
    MessageSignature,
    RequestType0,
    RequestType,
    Location,
    Range,
    Position,
} from "vscode-languageclient/node";
import * as p2c from "vscode-languageclient/lib/common/protocolConverter";
import { LSPTestDiscovery } from "../../../src/TestExplorer/LSPTestDiscovery";
import { SwiftPackage, Target, TargetType } from "../../../src/SwiftPackage";
import { TestClass } from "../../../src/TestExplorer/TestDiscovery";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import {
    LSPTestItem,
    TextDocumentTestsRequest,
    WorkspaceTestsRequest,
} from "../../../src/sourcekit-lsp/extensions";
import { instance, mockFn, mockObject } from "../../MockUtils";
import { LanguageClientManager } from "../../../src/sourcekit-lsp/LanguageClientManager";

class TestLanguageClient {
    private responses = new Map<string, unknown>();
    private responseVersions = new Map<string, number>();
    private client = mockObject<LanguageClient>({
        initializeResult: {
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
        },
        protocol2CodeConverter: p2c.createConverter(undefined, true, true),
        sendRequest: mockFn(s =>
            s.callsFake((type: MessageSignature): Promise<unknown> => {
                const response = this.responses.get(type.method);
                return response
                    ? Promise.resolve(response)
                    : Promise.reject("Method not implemented");
            })
        ),
    });

    public get languageClient(): LanguageClient {
        return instance(this.client);
    }

    setResponse<R, E>(type: RequestType0<R, E>, response: R): void;
    setResponse<P, R, E>(type: RequestType<P, R, E>, response: R): void;
    setResponse(type: MessageSignature, response: unknown) {
        this.responses.set(type.method, response);
    }

    setResponseVersion(type: MessageSignature, version: number) {
        this.responseVersions.set(type.method, version);
    }
}

suite("LSPTestDiscovery Suite", () => {
    let client: TestLanguageClient;
    let discoverer: LSPTestDiscovery;
    let pkg: SwiftPackage;
    const file = vscode.Uri.file("file:///some/file.swift");

    beforeEach(async function () {
        this.timeout(10000000);
        pkg = await SwiftPackage.create(file, await SwiftToolchain.create());
        client = new TestLanguageClient();
        discoverer = new LSPTestDiscovery(
            instance(
                mockObject<LanguageClientManager>({
                    useLanguageClient: mockFn(s =>
                        s.callsFake(process => {
                            return process(
                                client.languageClient,
                                new vscode.CancellationTokenSource().token
                            );
                        })
                    ),
                })
            )
        );
    });

    suite("Empty responses", () => {
        test(TextDocumentTestsRequest.method, async () => {
            client.setResponse(TextDocumentTestsRequest.type, []);

            const testClasses = await discoverer.getDocumentTests(pkg, file);

            assert.deepStrictEqual(testClasses, []);
        });

        test(WorkspaceTestsRequest.method, async () => {
            client.setResponse(WorkspaceTestsRequest.type, []);

            const testClasses = await discoverer.getWorkspaceTests(pkg);

            assert.deepStrictEqual(testClasses, []);
        });
    });

    suite("Unsupported LSP version", () => {
        test(TextDocumentTestsRequest.method, async () => {
            client.setResponseVersion(TextDocumentTestsRequest.type, 0);

            await assert.rejects(() => discoverer.getDocumentTests(pkg, file));
        });

        test(WorkspaceTestsRequest.method, async () => {
            client.setResponseVersion(WorkspaceTestsRequest.type, 0);

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
                    location: Location.create(
                        file.fsPath,
                        Range.create(Position.create(1, 0), Position.create(2, 0))
                    ),
                    children: [],
                },
            ];

            expected = items.map(item => ({
                ...item,
                location: client.languageClient.protocol2CodeConverter.asLocation(item.location),
                children: [],
            }));
        });

        test(TextDocumentTestsRequest.method, async () => {
            client.setResponse(TextDocumentTestsRequest.type, items);

            const testClasses = await discoverer.getDocumentTests(pkg, file);

            assert.deepStrictEqual(testClasses, expected);
        });

        test(WorkspaceTestsRequest.method, async () => {
            client.setResponse(WorkspaceTestsRequest.type, items);

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

            client.setResponse(WorkspaceTestsRequest.type, items);

            const testClasses = await discoverer.getWorkspaceTests(pkg);

            assert.deepStrictEqual(testClasses, expected);
        });

        test("Prepends test target to ID", async () => {
            const testTargetName = "TestTargetC99Name";
            expected = expected.map(item => ({
                ...item,
                id: `${testTargetName}.topLevelTest()`,
            }));

            client.setResponse(WorkspaceTestsRequest.type, items);

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
