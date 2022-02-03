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
import { PackageWatcher } from "./PackageWatcher";
import { SwiftPackage } from "./SwiftPackage";
import { WorkspaceContext } from "./WorkspaceContext";

export class FolderContext implements vscode.Disposable {
    private packageWatcher?: PackageWatcher;

    /**
     * FolderContext constructor
     * @param folder Workspace Folder
     * @param swiftPackage Swift Package inside the folder
     * @param workspaceContext Workspace context
     */
    private constructor(
        public folder: vscode.Uri,
        public swiftPackage: SwiftPackage,
        public workspaceFolder: vscode.WorkspaceFolder,
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
     * @param workspaceContext Workspace context for extension
     * @returns a new FolderContext
     */
    static async create(
        folder: vscode.Uri,
        workspaceFolder: vscode.WorkspaceFolder,
        workspaceContext: WorkspaceContext
    ): Promise<FolderContext> {
        const statusItemText = `Loading Package (${FolderContext.uriName(folder)})`;
        workspaceContext.statusItem.start(statusItemText);

        const swiftPackage = await SwiftPackage.create(folder);

        workspaceContext.statusItem.end(statusItemText);

        return new FolderContext(folder, swiftPackage, workspaceFolder, workspaceContext);
    }

    get name(): string {
        return `${this.workspaceFolder.name}${this.relativePath}`;
    }

    get relativePath(): string {
        return path.relative(this.workspaceFolder.uri.fsPath, this.folder.fsPath);
    }

    /** reload swift package for this folder */
    async reload() {
        await this.swiftPackage.reload();
    }

    /** reload Package.resolved for this folder */
    async reloadPackageResolved() {
        await this.swiftPackage.reloadPackageResolved();
    }

    editedPackageFolder(identifier: string) {
        return path.join(this.folder.fsPath, "Packages", identifier);
    }

    async getEditedPackages(): Promise<EditedPackage[]> {
        const workspaceState = await this.swiftPackage.loadWorkspaceState();
        return (
            workspaceState?.object.dependencies
                .filter(item => {
                    return item.state.name === "edited" && item.state.path;
                })
                .map(item => {
                    return { name: item.packageRef.identity, folder: item.state.path! };
                }) ?? []
        );
    }

    static uriName(uri: vscode.Uri): string {
        return path.basename(uri.fsPath);
    }
}

export interface EditedPackage {
    name: string;
    folder: string;
}
