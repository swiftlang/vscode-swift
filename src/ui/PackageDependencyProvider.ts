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
import * as fs from "fs/promises";
import * as path from "path";
import configuration from "../configuration";
import { getRepositoryName } from "../utilities/utilities";
import { WorkspaceContext } from "../WorkspaceContext";
import { FolderEvent } from "../WorkspaceContext";
import { FolderContext } from "../FolderContext";
import contextKeys from "../contextKeys";

/**
 * References:
 *
 * - Contributing views:
 *   https://code.visualstudio.com/api/references/contribution-points#contributes.views
 * - Contributing welcome views:
 *   https://code.visualstudio.com/api/references/contribution-points#contributes.viewsWelcome
 * - Implementing a TreeView:
 *   https://code.visualstudio.com/api/extension-guides/tree-view
 */

/**
 * A package in the Package Dependencies {@link vscode.TreeView TreeView}.
 */
export class PackageNode {
    constructor(
        public name: string,
        public path: string,
        public version: string,
        public type: "local" | "remote" | "editing"
    ) {}

    toTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = this.path;
        item.description = this.version;
        item.iconPath =
            this.type === "editing"
                ? new vscode.ThemeIcon("edit")
                : new vscode.ThemeIcon("archive");
        item.contextValue = this.type;
        return item;
    }
}

/**
 * A file or directory in the Package Dependencies {@link vscode.TreeView TreeView}.
 */
class FileNode {
    constructor(public name: string, public path: string, public isDirectory: boolean) {}

    toTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(
            this.name,
            this.isDirectory
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        item.id = this.path;
        item.resourceUri = vscode.Uri.file(this.path);
        if (!this.isDirectory) {
            item.command = {
                command: "vscode.open",
                arguments: [item.resourceUri],
                title: "Open File",
            };
        }
        return item;
    }
}

/**
 * A node in the Package Dependencies {@link vscode.TreeView TreeView}.
 *
 * Can be either a {@link PackageNode} or a {@link FileNode}.
 */
type TreeNode = PackageNode | FileNode;

/**
 * A {@link vscode.TreeDataProvider TreeDataProvider} for the Package Dependencies {@link vscode.TreeView TreeView}.
 */
export class PackageDependenciesProvider implements vscode.TreeDataProvider<TreeNode> {
    private didChangeTreeDataEmitter = new vscode.EventEmitter<
        TreeNode | undefined | null | void
    >();
    private workspaceObserver: vscode.Disposable;

    onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

    constructor(private workspaceContext: WorkspaceContext) {
        this.workspaceObserver = this.workspaceContext.observeFolders((folder, event) => {
            switch (event) {
                case FolderEvent.focus:
                    this.updateView(folder);
                    break;
                case FolderEvent.unfocus:
                    this.updateView(undefined);
                    break;
                case FolderEvent.resolvedUpdated:
                    if (folder === this.workspaceContext.currentFolder) {
                        this.updateView(folder);
                    }
            }
        });
    }

    dispose() {
        this.workspaceObserver.dispose();
    }

    updateView(folderContext?: FolderContext) {
        if (!folderContext || !folderContext.swiftPackage.foundPackage) {
            contextKeys.hasPackage = false;
            contextKeys.packageHasDependencies = false;
            return;
        }
        contextKeys.hasPackage = true;
        contextKeys.packageHasDependencies = folderContext.swiftPackage.dependencies.length > 0;
        this.didChangeTreeDataEmitter.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element.toTreeItem();
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        const folderContext = this.workspaceContext.currentFolder;
        if (!folderContext) {
            return [];
        }
        if (!element) {
            // Build PackageNodes for all dependencies.
            const children = [
                ...this.getLocalDependencies(folderContext),
                ...this.getRemoteDependencies(folderContext),
                ...(await this.getEditedDependencies(folderContext)),
            ].sort((first, second) => first.name.localeCompare(second.name));
            return children;
        }
        if (element instanceof PackageNode) {
            // Read the contents of a package.
            const packagePath =
                element.type === "remote"
                    ? path.join(
                          folderContext.folder.uri.fsPath,
                          ".build",
                          "checkouts",
                          getRepositoryName(element.path)
                      )
                    : element.path;
            return this.getNodesInDirectory(packagePath);
        } else {
            // Read the contents of a directory within a package.
            return this.getNodesInDirectory(element.path);
        }
    }

    /**
     * Returns a {@link PackageNode} for every local dependency
     * declared in **Package.swift**.
     */
    private getLocalDependencies(folderContext: FolderContext): PackageNode[] {
        return folderContext.swiftPackage.dependencies
            .filter(dependency => !dependency.requirement && dependency.url)
            .map(
                dependency =>
                    new PackageNode(dependency.identity, dependency.url!, "local", "local")
            );
    }

    /**
     * Returns a {@link PackageNode} for every remote dependency.
     */
    private getRemoteDependencies(folderContext: FolderContext): PackageNode[] {
        return (
            folderContext.swiftPackage.resolved?.object.pins.map(
                pin =>
                    new PackageNode(
                        pin.package,
                        pin.repositoryURL,
                        pin.state.version ?? pin.state.branch ?? pin.state.revision.substring(0, 7),
                        "remote"
                    )
            ) ?? []
        );
    }

    /**
     * Return list of package dependencies in edit mode
     * @param folderContext Folder to get edited dependencies for
     * @returns Array of packages
     */
    private async getEditedDependencies(folderContext: FolderContext): Promise<PackageNode[]> {
        return (await folderContext.getEditedPackages()).map(
            item => new PackageNode(item.name, item.folder, "local", "editing")
        );
        /*        try {
            const packagePath = folderContext.editedPackagesFolder();
            const packagePathContents = await fs.readdir(packagePath, { withFileTypes: true });
            return Promise.all(
                await packagePathContents
                    .filter(item => item.isDirectory() || item.isSymbolicLink())
                    .map(async item => {
                        let folder = path.join(packagePath, item.name);
                        if (item.isSymbolicLink()) {
                            folder = await fs.readlink(folder, "utf8");
                        }
                        return new PackageNode(item.name, folder, "local", "editing");
                    })
            );
        } catch {
            // ignore errors. They basically mean there was no Packages folder
        }
        return [];*/
    }

    /**
     * Returns a {@link FileNode} for every file or subdirectory
     * in the given directory.
     */
    private async getNodesInDirectory(directoryPath: string): Promise<FileNode[]> {
        const contents = await fs.readdir(directoryPath);
        const results: FileNode[] = [];
        const excludes = configuration.excludePathsFromPackageDependencies;
        for (const fileName of contents) {
            if (excludes.includes(fileName)) {
                continue;
            }
            const filePath = path.join(directoryPath, fileName);
            const stats = await fs.stat(filePath);
            results.push(new FileNode(fileName, filePath, stats.isDirectory()));
        }
        return results.sort((first, second) => {
            if (first.isDirectory === second.isDirectory) {
                // If both nodes are of the same type, sort them by name.
                return first.name.localeCompare(second.name);
            } else {
                // Otherwise, sort directories first.
                return first.isDirectory ? -1 : 1;
            }
        });
    }
}
