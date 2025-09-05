//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as fs from "fs/promises";
import * as vscode from "vscode";

/**
 * Registers a {@link vscode.TextDocumentContentProvider TextDocumentContentProvider} that will display
 * a readonly version of a file
 */
export function getReadOnlyDocumentProvider(): vscode.Disposable {
    const provider = vscode.workspace.registerTextDocumentContentProvider("readonly", {
        provideTextDocumentContent: async uri => {
            try {
                const contents = await fs.readFile(uri.fsPath, "utf8");
                return contents;
            } catch (error) {
                return `Failed to load swiftinterface ${uri.path}`;
            }
        },
    });
    return provider;
}
