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
import { WorkspaceContext } from "../WorkspaceContext";
import { FolderEvent } from "../WorkspaceContext";
import { FolderContext } from "../FolderContext";
import contextKeys from "../contextKeys";
import { Version } from "../utilities/version";
import { dependencyVersion, dependencyType, dependencyPackagePath } from "../SwiftPackage";

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
        public identity: string,
        public name: string,
        public path: string,
        public version: string,
        public type: "local" | "remote" | "edited"
    ) {}

    toTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = this.path;
        item.description = this.version;
        item.iconPath =
            this.type === "edited" ? new vscode.ThemeIcon("edit") : new vscode.ThemeIcon("package");
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
    private workspaceObserver?: vscode.Disposable;

    onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

    constructor(private workspaceContext: WorkspaceContext) {
        // default context key to false. These will be updated as folders are given focus
        contextKeys.hasPackage = false;
        contextKeys.packageHasDependencies = false;
    }

    dispose() {
        this.workspaceObserver?.dispose();
    }

    observeFolders(treeView: vscode.TreeView<TreeNode>) {
        this.workspaceObserver = this.workspaceContext.observeFolders((folder, event) => {
            switch (event) {
                case FolderEvent.focus:
                    if (!folder) {
                        return;
                    }
                    treeView.title = `Package Dependencies (${folder.name})`;
                    this.didChangeTreeDataEmitter.fire();
                    break;
                case FolderEvent.unfocus:
                    treeView.title = `Package Dependencies`;
                    this.didChangeTreeDataEmitter.fire();
                    break;
                case FolderEvent.workspaceStateUpdated:
                    if (!folder) {
                        return;
                    }

                    if (folder === this.workspaceContext.currentFolder) {
                        treeView.title = `Package Dependencies (${folder.name})`;
                        this.didChangeTreeDataEmitter.fire();
                    }
            }
        });
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
            // Build PackageNodes for all dependencies. Because Package.resolved might not
            // be up to date with edited dependency list, we need to remove the edited
            // dependencies from the list before adding in the edit version
            return await this.getDependencyGraph(folderContext);
        }

        // Read the contents of a package.
        return this.getNodesInDirectory(element.path);
    }

    private async getDependencyGraph(folderContext: FolderContext): Promise<PackageNode[]> {
        const graph = await folderContext.resolveDependencyGraph();
        return graph.map(dependency => {
            const version = dependencyVersion(dependency);
            const type = dependencyType(dependency);
            const packagePath = dependencyPackagePath(dependency, folderContext.folder.fsPath);

            return new PackageNode(
                dependency.packageRef.identity,
                dependency.packageRef.name,
                packagePath,
                version,
                type
            );
        });
    }

    /**
     * Returns a {@link PackageNode} for every local dependency
     * declared in **Package.swift**.
     */
    private getLocalDependencies(folderContext: FolderContext): PackageNode[] {
        const swiftVersion = folderContext.workspaceContext.toolchain.swiftVersion;
        // prior to Swift 5.6 local dependencies had no requirements
        if (swiftVersion.isLessThan(new Version(5, 6, 0))) {
            return folderContext.swiftPackage.dependencies
                .filter(dependency => !dependency.requirement && dependency.url)
                .map(
                    dependency =>
                        new PackageNode(
                            dependency.identity,
                            dependency.identity,
                            dependency.url!,
                            "local",
                            "local"
                        )
                );
        } else {
            // since Swift 5.6 local dependencies have `type` `fileSystem`
            return folderContext.swiftPackage.dependencies
                .filter(dependency => dependency.type === "fileSystem" && dependency.path)
                .map(
                    dependency =>
                        new PackageNode(
                            dependency.identity,
                            dependency.identity,
                            dependency.path!,
                            "local",
                            "local"
                        )
                );
        }
    }

    /**
     * Returns a {@link PackageNode} for every remote dependency.
     */
    private getRemoteDependencies(folderContext: FolderContext): PackageNode[] {
        return (
            folderContext.swiftPackage.resolved?.pins.map(
                pin =>
                    new PackageNode(
                        pin.identity,
                        pin.identity,
                        pin.location,
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
            item => new PackageNode(item.name, item.name, item.folder, "local", "edited")
        );
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
