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
import * as fs from 'fs/promises';
import * as path from 'path';
import configuration from './configuration';
import { getRepositoryName, pathExists } from './utilities';
import { FolderContext } from './FolderContext';

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
 * The pinned state of a package, as parsed from **Package.resolved**.
 */
interface PinnedPackage {
    
    package: string;
    repositoryURL: string;
    state: {
        branch?: string;
        revision: string;
        version?: string;
    }
}

/**
 * A package in the Package Dependencies {@link vscode.TreeView TreeView}.
 */ 
class PackageNode {

    constructor(
        public name: string,
        public path: string,
        public version: string,
        public type: 'local' | 'remote'
    ) { }

    toTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(
            this.name,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        item.id = this.path;
        item.description = this.version;
        item.iconPath = new vscode.ThemeIcon('archive');
        return item;
    }
}

/**
 * A file or directory in the Package Dependencies {@link vscode.TreeView TreeView}.
 */
class FileNode {

    constructor(
        public name: string,
        public path: string,
        public isDirectory: boolean
    ) { }

    toTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(
            this.name,
            this.isDirectory ?
                vscode.TreeItemCollapsibleState.Collapsed :
                vscode.TreeItemCollapsibleState.None
        );
        item.id = this.path;
        item.resourceUri = vscode.Uri.file(this.path);
        if (!this.isDirectory) {
            item.command = {
                command: 'vscode.open',
                arguments: [item.resourceUri],
                title: 'Open File'
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

    private didChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

    constructor(private ctx: FolderContext) {
        // Refresh the tree when a package resolve or package update task completes.
        vscode.tasks.onDidEndTask((event) => {
            const definition = event.execution.task.definition;
            if (definition.command === 'swift' && definition.args[0] === 'package' &&
               (definition.args[1] === 'resolve' || definition.args[1] === 'update')) {
                this.didChangeTreeDataEmitter.fire();
            }
        });
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element.toTreeItem();
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        if (!element) {
            // Build PackageNodes for all dependencies.
            return [
                ...this.getLocalDependencies(),
                ...await this.getRemoteDependencies()
            ].sort((first, second) => first.name.localeCompare(second.name));
        }
        if (element instanceof PackageNode) {
            // Read the contents of a package.
            const packagePath = element.type === 'remote' ?
                path.join(this.ctx.folder.uri.fsPath, '.build', 'checkouts', getRepositoryName(element.path)) :
                element.path;
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
    private getLocalDependencies(): PackageNode[] {
        return this.ctx.swiftPackage.dependencies.filter(
            dependency => !dependency.requirement && dependency.url 
        ).map(dependency => new PackageNode(
            dependency.identity,
            dependency.url!,
            'local',
            'local'
        ));
    }

    /**
     * Returns a {@link PackageNode} for every remote dependency.
     */
    private async getRemoteDependencies(): Promise<PackageNode[]> {
        if (!await pathExists(this.ctx.folder.uri.fsPath, 'Package.resolved')) {
            return [];
        }
        const data = await fs.readFile(path.join(this.ctx.folder.uri.fsPath, 'Package.resolved'), 'utf8');
        return JSON.parse(data).object.pins.map((pin: PinnedPackage) => new PackageNode(
            pin.package,
            pin.repositoryURL,
            pin.state.version ?? pin.state.branch ?? pin.state.revision.substring(0, 7),
            'remote'
        ));
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
            results.push(new FileNode(
                fileName,
                filePath,
                stats.isDirectory()
            ));
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
