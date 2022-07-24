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
import { getRepositoryName, buildDirectoryFromWorkspacePath } from "../utilities/utilities";
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
        public identity: string,
        public name: string,
        public path: string,
        public version: string,
        public type: "local" | "remote" | "editing",
        public packagePath: string = ""
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
                case FolderEvent.resolvedUpdated:
                    if (!folder) {
                        return;
                    }
                    if (folder === this.workspaceContext.currentFolder) {
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
            const children = await this.getAllDependencies(folderContext);
            return children;
        }

        if (element instanceof PackageNode) {
            // Read the contents of a package.
            return this.getNodesInDirectory(element.packagePath);
        } else {
            // Read the contents of a directory within a package.
            return this.getNodesInDirectory(element.path);
        }
    }

    private async getAllDependencies(folderContext: FolderContext): Promise<PackageNode[]> {
        return (await folderContext.getAllPackages()).map(dependency => {
            const version =
                dependency.packageRef.kind === "fileSystem"
                    ? "local"
                    : dependency.state.checkoutState?.version ??
                      dependency.state.checkoutState?.branch ??
                      "editing";

            const type =
                dependency.state.name === "edited"
                    ? "editing"
                    : dependency.packageRef.kind === "fileSystem"
                    ? "local"
                    : "remote";

            let packagePath = "";
            if (type === "editing") {
                packagePath =
                    dependency.state.path ??
                    path.join(folderContext.folder.fsPath, "Packages", dependency.subpath);
            } else if (type === "local") {
                packagePath = dependency.state.path ?? dependency.packageRef.location;
            } else {
                // remote
                const buildDirectory = buildDirectoryFromWorkspacePath(
                    folderContext.folder.fsPath,
                    true
                );
                packagePath = path.join(buildDirectory, "checkouts", dependency.subpath);
            }

            return new PackageNode(
                dependency.packageRef.identity,
                dependency.packageRef.name,
                dependency.packageRef.location!,
                version,
                type,
                packagePath
            );
        });
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
