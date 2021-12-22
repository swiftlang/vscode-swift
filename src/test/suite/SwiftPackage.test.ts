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
    }).timeout(5000);

	test('Invalid package', async () => {
        let spmPackage = await SwiftPackage.create(testAssetWorkspaceFolder('invalid-package'));
        assert.strictEqual(spmPackage.foundPackage, true);
        assert.strictEqual(spmPackage.isValid, false);
    }).timeout(5000);

	test('Executable package', async () => {
        let spmPackage = await SwiftPackage.create(testAssetWorkspaceFolder('package1'));
        assert.strictEqual(spmPackage.isValid, true)
        assert.strictEqual(spmPackage.executableProducts.length, 1);
        assert.strictEqual(spmPackage.executableProducts[0].name, "package1");
        assert.strictEqual(spmPackage.dependencies.length, 1);
        assert.strictEqual(spmPackage.targets.length, 2);
    }).timeout(5000);

	test('Library package', async () => {
        let spmPackage = await SwiftPackage.create(testAssetWorkspaceFolder('package2'));
        assert.strictEqual(spmPackage.isValid, true)
        assert.strictEqual(spmPackage.libraryProducts.length, 1);
        assert.strictEqual(spmPackage.libraryProducts[0].name, "package2");
        assert.strictEqual(spmPackage.dependencies.length, 0);
        assert.strictEqual(spmPackage.targets.length, 2);
    }).timeout(5000);
});
