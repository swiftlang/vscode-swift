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
import { parseTestsFromDocumentSymbols } from "@src/TestExplorer/DocumentSymbolTestDiscovery";
import { TestClass } from "@src/TestExplorer/TestDiscovery";

suite("DocumentSymbolTestDiscovery Suite", () => {
    const mockRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
    const mockUri = vscode.Uri.file("file:///var/foo");
    const basicXCTest: TestClass = {
        id: "",
        label: "",
        disabled: false,
        style: "XCTest",
        location: {
            range: mockRange,
            uri: mockUri,
        },
        children: [],
        tags: [{ id: "XCTest" }],
    };

    test("Parse empty document symbols", async () => {
        const tests = parseTestsFromDocumentSymbols("TestTarget", [], mockUri);
        assert.deepEqual(tests, []);
    });

    test("Parse empty test suite", async () => {
        const symbols = [
            new vscode.DocumentSymbol(
                "MyXCTestCase",
                "",
                vscode.SymbolKind.Class,
                mockRange,
                mockRange
            ),
        ];

        const tests = parseTestsFromDocumentSymbols("TestTarget", symbols, mockUri);
        assert.deepEqual(tests, []);
    });

    test("Parse suite with one test", async () => {
        const testClass = new vscode.DocumentSymbol(
            "MyXCTestCase",
            "",
            vscode.SymbolKind.Class,
            mockRange,
            mockRange
        );
        testClass.children = [
            new vscode.DocumentSymbol(
                "testFoo()",
                "",
                vscode.SymbolKind.Method,
                mockRange,
                mockRange
            ),
        ];

        const tests = parseTestsFromDocumentSymbols("TestTarget", [testClass], mockUri);
        assert.deepEqual(tests, [
            {
                ...basicXCTest,
                id: "TestTarget",
                label: "TestTarget",
                location: undefined,
                tags: [{ id: "test-target" }],
                children: [
                    {
                        ...basicXCTest,
                        id: "TestTarget.MyXCTestCase",
                        label: "MyXCTestCase",
                        tags: [{ id: "XCTest" }],
                        children: [
                            {
                                ...basicXCTest,
                                id: "TestTarget.MyXCTestCase/testFoo",
                                label: "testFoo",
                                tags: [{ id: "XCTest" }],
                            },
                        ],
                    },
                ],
            },
        ]);
    });
});
