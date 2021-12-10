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

import * as vscode from 'vscode';
import { PackageWatcher } from './PackageWatcher';
import { SwiftPackage } from './SwiftPackage';

export class FolderContext implements vscode.Disposable {
    private packageWatcher?: PackageWatcher;

	private constructor(
        public rootFolder: vscode.WorkspaceFolder,
        public swiftPackage: SwiftPackage,
        private _isRootFolder: boolean
    ) {
        if (this.isRootFolder) {
            this.packageWatcher = new PackageWatcher(this);
            this.packageWatcher.install();
            this.packageWatcher.handlePackageChange();
        }
    }

    dispose() {
        this.packageWatcher?.dispose();
    }

    get isRootFolder(): boolean {
        return this._isRootFolder;
    }

    static async create(
        rootFolder: vscode.WorkspaceFolder,
        isRootFolder: boolean
    ): Promise<FolderContext> 
    {
        let swiftPackage = await SwiftPackage.create(rootFolder);
        return new FolderContext(rootFolder, swiftPackage, isRootFolder);
    }
}

