//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as fs from "fs/promises";

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
