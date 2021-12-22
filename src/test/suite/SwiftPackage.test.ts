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
import { SwiftPackage } from '../../SwiftPackage';
import { integer } from 'vscode-languageclient';

class TestWorkspaceFolder implements vscode.WorkspaceFolder {
    constructor(
        readonly uri: vscode.Uri
    ) {}
    get name(): string { return path.basename(this.uri.fsPath); }
    get index(): integer { return 0; }
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

suite('SwiftPackage Test Suite', () => {
	test('No package', async () => {
        let spmPackage = await SwiftPackage.create(testAssetWorkspaceFolder('empty-folder'));
        assert.strictEqual(spmPackage.foundPackage, false);
    });

	test('Invalid package', async () => {
        let spmPackage = await SwiftPackage.create(testAssetWorkspaceFolder('invalid-package'));
        assert.strictEqual(spmPackage.foundPackage, true);
        assert.strictEqual(spmPackage.isValid, false);
    });

	test('Working package', async () => {
        let spmPackage = await SwiftPackage.create(testAssetWorkspaceFolder('package1'));
        assert.strictEqual(spmPackage.isValid, true)
        assert.strictEqual(spmPackage.products.length, 1);
        assert.strictEqual(spmPackage.products[0].name, "package1");
        assert.strictEqual(spmPackage.dependencies.length, 1);
        assert.strictEqual(spmPackage.targets.length, 2);
    });
});
