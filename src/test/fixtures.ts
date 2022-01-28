//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as path from "path";

/** Workspace folder class */
class TestWorkspaceFolder implements vscode.WorkspaceFolder {
    constructor(readonly uri: vscode.Uri) {}
    get name(): string {
        return path.basename(this.uri.fsPath);
    }
    get index(): number {
        return 0;
    }
}

/**
 * @returns the {@link vscode.Uri URI} of a resource in the **test** directory.
 */
export function testAssetUri(name: string): vscode.Uri {
    return vscode.Uri.file(path.resolve(__dirname, "../../assets/test", name));
}

/**
 * @returns the {@link vscode.Uri URI} of a resource in the **test** directory.
 */
export function testAssetWorkspaceFolder(name: string): vscode.WorkspaceFolder {
    return new TestWorkspaceFolder(testAssetUri(name));
}
