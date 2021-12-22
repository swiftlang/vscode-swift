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

import * as path from 'path';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { integer } from 'vscode-languageclient';
import { SwiftExtensionContext, WorkspaceContext } from '../../WorkspaceContext';

class TestWorkspaceFolder implements vscode.WorkspaceFolder {
    constructor(
        readonly uri: vscode.Uri
    ) {}
    get name(): string { return path.basename(this.uri.fsPath); }
    get index(): integer { return 0; }
}

class TestExtensionContext implements SwiftExtensionContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly subscriptions: { dispose(): any }[] = [];
}

/**
  * @returns the {@link vscode.Uri URI} of a resource in the **test** directory.
  */
 export function testAssetUri(name: string): vscode.Uri {
    return vscode.Uri.file(path.resolve(__dirname, '../../../assets/test', name));
}

/**
  * @returns the {@link vscode.Uri URI} of a resource in the **test** directory.
  */
 export function testAssetWorkspaceFolder(name: string): vscode.WorkspaceFolder {
    return new TestWorkspaceFolder(testAssetUri(name));
}

suite('WorkspaceContext Test Suite', () => {
	test('Add/Remove', async () => {
        let count = 0;
        const workspaceContext = new WorkspaceContext(new TestExtensionContext());
        workspaceContext.observerFolders((folder, operation) => {
            assert.strictEqual(folder.swiftPackage.name, 'package1');
            switch (operation) {
            case 'add':
                count++;
                break;
            case 'remove':
                count--;
                break;
            }
        });
        const packageFolder = testAssetWorkspaceFolder('package1');
        await workspaceContext.addFolder(packageFolder);
        await workspaceContext.removeFolder(packageFolder);
        assert.strictEqual(count, 0);
    }).timeout(5000);
});
