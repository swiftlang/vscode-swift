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
import { PackageWatcher } from "./PackageWatcher";
import { SwiftPackage } from "./SwiftPackage";
import { WorkspaceContext } from "./WorkspaceContext";

export class FolderContext implements vscode.Disposable {
    private packageWatcher?: PackageWatcher;

    /**
     * FolderContext constructor
     * @param folder Workspace Folder
     * @param swiftPackage Swift Package inside the folder
     * @param isRootFolder Is this a root folder
     * @param workspaceContext Workspace context
     */
    private constructor(
        public folder: vscode.WorkspaceFolder,
        public swiftPackage: SwiftPackage,
        readonly isRootFolder: boolean,
        public workspaceContext: WorkspaceContext
    ) {
        this.packageWatcher = new PackageWatcher(this, workspaceContext);
        this.packageWatcher.install();
    }

    /** dispose of any thing FolderContext holds */
    dispose() {
        this.packageWatcher?.dispose();
    }

    /**
     * Create FolderContext
     * @param folder Folder that Folder Context is being created for
     * @param isRootFolder Is this a root folder
     * @param workspaceContext Workspace context for extension
     * @returns a new FolderContext
     */
    static async create(
        folder: vscode.WorkspaceFolder,
        isRootFolder: boolean,
        workspaceContext: WorkspaceContext
    ): Promise<FolderContext> {
        const statusItemText = `Loading Package (${folder.name})`;
        workspaceContext.statusItem.start(statusItemText);

        const swiftPackage = await SwiftPackage.create(folder);

        workspaceContext.statusItem.end(statusItemText);

        return new FolderContext(folder, swiftPackage, isRootFolder, workspaceContext);
    }

    /** reload swift package for this folder */
    async reload() {
        await this.swiftPackage.reload();
    }

    /** reload Package.resolved for this folder */
    async reloadPackageResolved() {
        await this.swiftPackage.reloadPackageResolved();
    }
}
