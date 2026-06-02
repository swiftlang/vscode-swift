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

import { parseTestsFromSwiftTestListOutput } from "./SPMTestDiscovery";
import { TestClass } from "./TestDiscovery";

export function parseTestsFromDocumentSymbols(
    target: string,
    symbols: vscode.DocumentSymbol[],
    uri: vscode.Uri
): TestClass[] {
    // Converts a document into the output of `swift test list`.
    // This _only_ looks for XCTests.
    const locationLookup = new Map<string, vscode.Location | undefined>();
    const swiftTestListOutput = symbols
        .filter(
            symbol =>
                symbol.kind === vscode.SymbolKind.Class ||
                symbol.kind === vscode.SymbolKind.Namespace
        )
        .flatMap(symbol => {
            const functions = symbol.children
                .filter(func => func.kind === vscode.SymbolKind.Method)
                .filter(func => /^test.*\(\)/.test(func.name))
                .map(func => {
                    const openBrackets = func.name.indexOf("(");
                    let funcName = func.name;
                    if (openBrackets) {
                        funcName = func.name.slice(0, openBrackets);
                    }
                    return {
                        name: funcName,
                        location: new vscode.Location(uri, func.range),
                    };
                });

            const location =
                symbol.kind === vscode.SymbolKind.Class
                    ? new vscode.Location(uri, symbol.range)
                    : undefined;

            locationLookup.set(`${target}.${symbol.name}`, location);

            return functions.map(func => {
                const testName = `${target}.${symbol.name}/${func.name}`;
                locationLookup.set(testName, func.location);
                return testName;
            });
        })
        .join("\n");

    const tests = parseTestsFromSwiftTestListOutput(swiftTestListOutput);

    // The locations for each test case/suite were captured when processing the
    // symbols. Annotate the processed TestClasses with their locations.
    const annotatedTests = annotateTestsWithLocations(tests, locationLookup);
    return annotatedTests;
}

function annotateTestsWithLocations(
    tests: TestClass[],
    locations: Map<string, vscode.Location | undefined>
): TestClass[] {
    return tests.map(test => ({
        ...test,
        location: locations.get(test.id),
        children: annotateTestsWithLocations(test.children, locations),
    }));
}
