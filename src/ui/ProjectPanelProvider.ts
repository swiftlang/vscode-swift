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
import { Dependency, ResolvedDependency, Target } from "../SwiftPackage";
import { SwiftPluginTaskProvider } from "../tasks/SwiftPluginTaskProvider";

const LOADING_ICON = "loading~spin";
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
        private childDependencies: (dependency: Dependency) => ResolvedDependency[],
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
        item.iconPath = new vscode.ThemeIcon(this.icon());
        item.contextValue = this.dependency.type;
        item.accessibilityInformation = { label: `Package ${this.name}` };
        item.tooltip = this.path;
        return item;
    }

    icon() {
        if (this.dependency.type === "editing") {
            return "edit";
        }
        if (this.dependency.type === "local") {
            return "notebook-render-output";
        }
        return "package";
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

class TaskNode {
    constructor(
        public type: string,
        public name: string,
        private active: boolean
    ) {}

    toTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.None);
        item.id = `${this.type}-${this.name}`;
        item.iconPath = new vscode.ThemeIcon(this.active ? LOADING_ICON : "play");
        item.contextValue = "task";
        item.accessibilityInformation = { label: this.name };
        item.command = {
            command: "swift.runTask",
            arguments: [this.name],
            title: "Run Task",
        };
        return item;
    }

    getChildren(): TreeNode[] {
        return [];
    }
}

/*
 * Prefix a unique string on the test target name to avoid confusing it
 * with another target that may share the same name. Targets can't start with %
 * so this is guarenteed to be unique.
 */
function testTaskName(name: string): string {
    return `%test-${name}`;
}

function snippetTaskName(name: string): string {
    return `%snippet-${name}`;
}

class TargetNode {
    constructor(
        public target: Target,
        private activeTasks: Set<string>
    ) {}

    get name(): string {
        return this.target.name;
    }

    get args(): string[] {
        return [this.name];
    }

    toTreeItem(): vscode.TreeItem {
        const name = this.target.name;
        const hasChildren = this.getChildren().length > 0;
        const item = new vscode.TreeItem(
            name,
            hasChildren
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );
        item.id = `${this.target.type}:${name}`;
        item.iconPath = new vscode.ThemeIcon(this.icon());
        item.contextValue = this.contextValue();
        item.accessibilityInformation = { label: name };
        return item;
    }

    private icon(): string {
        if (this.activeTasks.has(this.name)) {
            return LOADING_ICON;
        }

        switch (this.target.type) {
            case "executable":
                return "output";
            case "library":
                return "library";
            case "test":
                if (this.activeTasks.has(testTaskName(this.name))) {
                    return LOADING_ICON;
                }
                return "test-view-icon";
            case "snippet":
                if (this.activeTasks.has(snippetTaskName(this.name))) {
                    return LOADING_ICON;
                }
                return "notebook";
            case "plugin":
                return "plug";
        }
    }

    private contextValue(): string | undefined {
        switch (this.target.type) {
            case "executable":
                return "runnable";
            case "snippet":
                return "snippet_runnable";
            case "test":
                return "test_runnable";
            default:
                return undefined;
        }
    }

    getChildren(): TreeNode[] {
        return [];
    }
}

class HeaderNode {
    constructor(
        private id: string,
        public name: string,
        private icon: string,
        private _getChildren: () => Promise<TreeNode[]>
    ) {}

    get path(): string {
        return "";
    }

    toTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = `${this.id}-${this.name}`;
        item.iconPath = new vscode.ThemeIcon(this.icon);
        item.contextValue = "header";
        item.accessibilityInformation = { label: this.name };
        return item;
    }

    getChildren(): Promise<TreeNode[]> {
        return this._getChildren();
    }
}

/**
 * A node in the Package Dependencies {@link vscode.TreeView TreeView}.
 *
 * Can be either a {@link PackageNode}, {@link FileNode}, {@link TargetNode}, {@link TaskNode} or {@link HeaderNode}.
 */
type TreeNode = PackageNode | FileNode | HeaderNode | TaskNode | TargetNode;

/**
 * A {@link vscode.TreeDataProvider<T> TreeDataProvider} for project dependencies, tasks and commands {@link vscode.TreeView TreeView}.
 */
export class ProjectPanelProvider implements vscode.TreeDataProvider<TreeNode> {
    private didChangeTreeDataEmitter = new vscode.EventEmitter<
        TreeNode | undefined | null | void
    >();
    private workspaceObserver?: vscode.Disposable;
    private disposables: vscode.Disposable[] = [];
    private activeTasks: Set<string> = new Set();

    onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

    constructor(private workspaceContext: WorkspaceContext) {
        // default context key to false. These will be updated as folders are given focus
        contextKeys.hasPackage = false;
        contextKeys.packageHasDependencies = false;

        this.observeTasks(workspaceContext);
    }

    dispose() {
        this.workspaceObserver?.dispose();
    }

    observeTasks(ctx: WorkspaceContext) {
        this.disposables.push(
            vscode.tasks.onDidStartTask(e => {
                const taskId = e.execution.task.detail ?? e.execution.task.name;
                this.activeTasks.add(taskId);
                this.didChangeTreeDataEmitter.fire();
            }),
            vscode.tasks.onDidEndTask(e => {
                const taskId = e.execution.task.detail ?? e.execution.task.name;
                this.activeTasks.delete(taskId);
                this.didChangeTreeDataEmitter.fire();
            }),
            ctx.onDidStartBuild(e => {
                if (e.launchConfig.runType === "snippet") {
                    this.activeTasks.add(snippetTaskName(e.targetName));
                } else {
                    this.activeTasks.add(e.targetName);
                }
                this.didChangeTreeDataEmitter.fire();
            }),
            ctx.onDidFinishBuild(e => {
                if (e.launchConfig.runType === "snippet") {
                    this.activeTasks.delete(snippetTaskName(e.targetName));
                } else {
                    this.activeTasks.delete(e.targetName);
                }
                this.didChangeTreeDataEmitter.fire();
            }),
            ctx.onDidStartTests(e => {
                for (const target of e.targets) {
                    this.activeTasks.add(testTaskName(target));
                }
                this.didChangeTreeDataEmitter.fire();
            }),
            ctx.onDidFinishTests(e => {
                for (const target of e.targets) {
                    this.activeTasks.delete(testTaskName(target));
                }
                this.didChangeTreeDataEmitter.fire();
            })
        );
    }

    observeFolders(treeView: vscode.TreeView<TreeNode>) {
        this.workspaceObserver = this.workspaceContext.onDidChangeFolders(
            ({ folder, operation }) => {
                switch (operation) {
                    case FolderOperation.focus:
                        if (!folder) {
                            return;
                        }
                        treeView.title = `Swift Project (${folder.name})`;
                        this.didChangeTreeDataEmitter.fire();
                        break;
                    case FolderOperation.unfocus:
                        treeView.title = `Swift Project`;
                        this.didChangeTreeDataEmitter.fire();
                        break;
                    case FolderOperation.workspaceStateUpdated:
                    case FolderOperation.resolvedUpdated:
                    case FolderOperation.packageViewUpdated:
                    case FolderOperation.pluginsUpdated:
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

        if (element) {
            return element.getChildren();
        }

        const dependencies = this.dependencies();
        const snippets = this.snippets();
        const commands = await this.commands();

        // TODO: Control ordering
        return [
            ...(dependencies.length > 0
                ? [
                      new HeaderNode(
                          "dependencies",
                          "Dependencies",
                          "circuit-board",
                          this.wrapInAsync(this.dependencies.bind(this))
                      ),
                  ]
                : []),
            new HeaderNode("targets", "Targets", "book", this.wrapInAsync(this.targets.bind(this))),
            new HeaderNode("tasks", "Tasks", "debug-continue-small", this.tasks.bind(this)),
            ...(snippets.length > 0
                ? [
                      new HeaderNode("snippets", "Snippets", "notebook", () =>
                          Promise.resolve(snippets)
                      ),
                  ]
                : []),
            ...(commands.length > 0
                ? [
                      new HeaderNode("commands", "Commands", "debug-line-by-line", () =>
                          Promise.resolve(commands)
                      ),
                  ]
                : []),
        ];
    }

    private dependencies(): TreeNode[] {
        const folderContext = this.workspaceContext.currentFolder;
        if (!folderContext) {
            return [];
        }
        const pkg = folderContext.swiftPackage;
        if (contextKeys.flatDependenciesList) {
            const existenceMap = new Map<string, boolean>();
            const gatherChildren = (dependencies: ResolvedDependency[]): ResolvedDependency[] => {
                const result: ResolvedDependency[] = [];
                for (const dep of dependencies) {
                    if (!existenceMap.has(dep.identity)) {
                        result.push(dep);
                        existenceMap.set(dep.identity, true);
                    }
                    const childDeps = pkg.childDependencies(dep);
                    result.push(...gatherChildren(childDeps));
                }
                return result;
            };

            const rootDeps = pkg.rootDependencies();
            const allDeps = gatherChildren(rootDeps);
            return allDeps.map(dependency => new PackageNode(dependency, () => []));
        } else {
            const childDeps = pkg.childDependencies.bind(pkg);
            return pkg.rootDependencies().map(dep => new PackageNode(dep, childDeps));
        }
    }

    private targets(): TreeNode[] {
        const folderContext = this.workspaceContext.currentFolder;
        if (!folderContext) {
            return [];
        }
        const targetSort = (node: TargetNode) => `${node.target.type}-${node.name}`;
        return (
            folderContext.swiftPackage.targets
                // Snipepts are shown under the Snippets header
                .filter(target => target.type !== "snippet")
                .map(target => new TargetNode(target, this.activeTasks))
                .sort((a, b) => targetSort(a).localeCompare(targetSort(b)))
        );
    }

    private async tasks(): Promise<TreeNode[]> {
        const tasks = await vscode.tasks.fetchTasks();
        return (
            tasks
                // Plugin tasks are shown under the Commands header
                .filter(task => task.source !== "swift-plugin")
                .map(
                    task =>
                        new TaskNode(
                            "task",
                            task.name,
                            this.activeTasks.has(task.detail ?? task.name)
                        )
                )
                .sort((a, b) => a.name.localeCompare(b.name))
        );
    }

    private async commands(): Promise<TreeNode[]> {
        const provider = new SwiftPluginTaskProvider(this.workspaceContext);
        const tasks = await provider.provideTasks(new vscode.CancellationTokenSource().token);
        return tasks
            .map(
                task =>
                    new TaskNode(
                        "command",
                        task.name,
                        this.activeTasks.has(task.detail ?? task.name)
                    )
            )
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private snippets(): TreeNode[] {
        const folderContext = this.workspaceContext.currentFolder;
        if (!folderContext) {
            return [];
        }
        return folderContext.swiftPackage.targets
            .filter(target => target.type === "snippet")
            .flatMap(target => new TargetNode(target, this.activeTasks))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private wrapInAsync<T>(fn: () => T): () => Promise<T> {
        return async () => fn();
    }
}
