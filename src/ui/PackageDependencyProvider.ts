//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import configuration from "../configuration";
import { WorkspaceContext } from "../WorkspaceContext";
import { FolderOperation } from "../WorkspaceContext";
import contextKeys from "../contextKeys";
import { Dependency, ResolvedDependency } from "../SwiftPackage";

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
 * Returns a {@link FileNode} for every file or subdirectory
 * in the given directory.
 */
async function getChildren(directoryPath: string, parentId?: string): Promise<FileNode[]> {
    const contents = await fs.readdir(directoryPath);
    const results: FileNode[] = [];
    const excludes = configuration.excludePathsFromPackageDependencies;
    for (const fileName of contents) {
        if (excludes.includes(fileName)) {
            continue;
        }
        const filePath = path.join(directoryPath, fileName);
        const stats = await fs.stat(filePath);
        results.push(new FileNode(fileName, filePath, stats.isDirectory(), parentId));
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

/**
 * A package in the Package Dependencies {@link vscode.TreeView TreeView}.
 */
export class PackageNode {
    private id: string;

    constructor(
        private dependency: ResolvedDependency,
        private childDependencies: (dependency: Dependency) => Promise<ResolvedDependency[]>,
        private parentId?: string
    ) {
        this.id =
            (this.parentId ? `${this.parentId}->` : "") +
            `${this.name}-${this.dependency.version ?? ""}`;
    }

    get name(): string {
        return this.dependency.identity;
    }

    get location(): string {
        return this.dependency.location;
    }

    get type(): string {
        return this.dependency.type;
    }

    get path(): string {
        return this.dependency.path ?? "";
    }

    toTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.description = this.dependency.version;
        item.iconPath =
            this.dependency.type === "editing"
                ? new vscode.ThemeIcon("edit")
                : new vscode.ThemeIcon("package");
        item.contextValue = this.dependency.type;
        item.accessibilityInformation = { label: `Package ${this.name}` };
        item.tooltip = this.path;
        return item;
    }

    async getChildren(): Promise<TreeNode[]> {
        const [childDeps, files] = await Promise.all([
            this.childDependencies(this.dependency),
            getChildren(this.dependency.path, this.id),
        ]);
        const childNodes = childDeps.map(
            dep => new PackageNode(dep, this.childDependencies, this.id)
        );

        // Show dependencies first, then files.
        return [...childNodes, ...files];
    }
}

/**
 * A file or directory in the Package Dependencies {@link vscode.TreeView TreeView}.
 */
export class FileNode {
    private id: string;

    constructor(
        public name: string,
        public path: string,
        public isDirectory: boolean,
        private parentId?: string
    ) {
        this.id = (this.parentId ? `${this.parentId}->` : "") + `${this.path}`;
    }

    toTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(
            this.name,
            this.isDirectory
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        item.id = this.id;
        item.resourceUri = vscode.Uri.file(this.path);
        item.tooltip = this.path;
        if (!this.isDirectory) {
            item.command = {
                command: "vscode.open",
                arguments: [item.resourceUri],
                title: "Open File",
            };
            item.accessibilityInformation = { label: `File ${this.name}` };
        } else {
            item.accessibilityInformation = { label: `Folder ${this.name}` };
        }
        return item;
    }

    async getChildren(): Promise<FileNode[]> {
        return await getChildren(this.path, this.id);
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
        this.workspaceObserver = this.workspaceContext.onDidChangeFolders(
            ({ folder, operation }) => {
                switch (operation) {
                    case FolderOperation.focus:
                        if (!folder) {
                            return;
                        }
                        treeView.title = `Package Dependencies (${folder.name})`;
                        this.didChangeTreeDataEmitter.fire();
                        break;
                    case FolderOperation.unfocus:
                        treeView.title = `Package Dependencies`;
                        this.didChangeTreeDataEmitter.fire();
                        break;
                    case FolderOperation.workspaceStateUpdated:
                    case FolderOperation.resolvedUpdated:
                        if (!folder) {
                            return;
                        }
                        if (folder === this.workspaceContext.currentFolder) {
                            this.didChangeTreeDataEmitter.fire();
                        }
                }
            }
        );
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
            return folderContext.swiftPackage
                .rootDependencies()
                .map(
                    dependency =>
                        new PackageNode(
                            dependency,
                            folderContext.swiftPackage.childDependencies.bind(
                                folderContext.swiftPackage
                            )
                        )
                );
        } else {
            return await element.getChildren();
        }
    }
}
