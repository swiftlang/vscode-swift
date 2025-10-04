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
import { convertPathToPattern, glob } from "fast-glob";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { Dependency, ResolvedDependency, Target } from "../SwiftPackage";
import { WorkspaceContext } from "../WorkspaceContext";
import { FolderOperation } from "../WorkspaceContext";
import configuration from "../configuration";
import { SwiftTask, TaskPlatformSpecificConfig } from "../tasks/SwiftTaskProvider";
import { getPlatformConfig, resolveTaskCwd } from "../utilities/tasks";
import { Version } from "../utilities/version";

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
 * Returns an array of file globs that define files that should be excluded from the project panel explorer.
 */
function excludedFilesForProjectPanelExplorer(): string[] {
    const config = vscode.workspace.getConfiguration("files");
    const packageDepsExcludeList = configuration.excludePathsFromPackageDependencies;
    if (!Array.isArray(packageDepsExcludeList)) {
        throw new Error("Expected excludePathsFromPackageDependencies to be an array");
    }

    const vscodeExcludeList = config.get<{ [key: string]: boolean }>("exclude") ?? {};
    const vscodeFileTypesToExclude = Object.keys(vscodeExcludeList).filter(
        key => vscodeExcludeList[key]
    );
    return [...packageDepsExcludeList, ...vscodeFileTypesToExclude];
}

/**
 * Returns a {@link FileNode} for every file or subdirectory
 * in the given directory.
 */
async function getChildren(
    directoryPath: string,
    excludedFiles: string[],
    parentId?: string,
    mockFs?: (folder: string) => Promise<string[]>
): Promise<FileNode[]> {
    const contents = mockFs
        ? await mockFs(directoryPath)
        : await glob(`${convertPathToPattern(directoryPath)}/*`, {
              ignore: excludedFiles,
              absolute: true,
              onlyFiles: false,
          });
    const results: FileNode[] = [];
    for (const filePath of contents) {
        const stats = await fs.stat(filePath);
        results.push(
            new FileNode(path.basename(filePath), filePath, stats.isDirectory(), parentId, mockFs)
        );
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

    /**
     * "instanceof" has a bad effect in our nightly tests when the VSIX
     * bundled source is used. For example:
     *
     * ```
     * vscode.commands.registerCommand(Commands.UNEDIT_DEPENDENCY, async (item, folder) => {
     *  if (item instanceof PackageNode) {
     *      return await uneditDependency(item.name, ctx, folder);
     *  }
     * }),
     * ```
     *
     * So instead we'll check for this set boolean property. Even if the implementation of the
     * {@link PackageNode} class changes, this property should not need to change
     */
    static isPackageNode = (item: { __isPackageNode?: boolean }) => item.__isPackageNode ?? false;
    __isPackageNode = true;

    constructor(
        private dependency: ResolvedDependency,
        private childDependencies: (dependency: Dependency) => ResolvedDependency[],
        private parentId?: string,
        private fs?: (folder: string) => Promise<string[]>
    ) {
        this.id =
            (this.parentId ? `${this.parentId}->` : "") +
            `${this.name}-${(this.dependency.version || this.dependency.revision?.substring(0, 7)) ?? ""}`;
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
        item.description = this.getDescription();
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
        const childDeps = this.childDependencies(this.dependency);
        const files = await getChildren(
            this.dependency.path,
            excludedFilesForProjectPanelExplorer(),
            this.id,
            this.fs
        );
        const childNodes = childDeps.map(
            dep => new PackageNode(dep, this.childDependencies, this.id)
        );

        // Show dependencies first, then files.
        return [...childNodes, ...files];
    }

    getDescription(): string {
        switch (this.type) {
            case "local":
                return "local";
            case "editing":
                return "editing";
            default:
                return (
                    // show the version if used, otherwise show the partial commit hash
                    (this.dependency.version || this.dependency.revision?.substring(0, 7)) ?? ""
                );
        }
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
        private parentId?: string,
        private fs?: (folder: string) => Promise<string[]>
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
        return await getChildren(
            this.path,
            excludedFilesForProjectPanelExplorer(),
            this.id,
            this.fs
        );
    }
}

class TaskNode {
    constructor(
        public type: string,
        public id: string,
        public name: string,
        private active: boolean
    ) {}

    toTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.None);
        item.id = `${this.type}-${this.id}`;
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
    private newPluginLayoutVersion = new Version(6, 0, 0);

    constructor(
        public target: Target,
        private folder: FolderContext,
        private activeTasks: Set<string>,
        private fs?: (folder: string) => Promise<string[]>
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
        item.tooltip = `${name} (${this.target.type})`;
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
            case "system-target":
                return "server";
            case "binary":
                return "file-binary";
            case "plugin":
                return "plug";
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
        return this.buildPluginOutputs(this.folder.toolchain.swiftVersion);
    }

    private buildToolGlobPattern(version: Version): string {
        const base = this.folder.folder.fsPath.replace(/\\/g, "/");
        if (version.isGreaterThanOrEqual(this.newPluginLayoutVersion)) {
            return `${base}/.build/plugins/outputs/*/${this.target.name}/*/*/**`;
        } else {
            return `${base}/.build/plugins/outputs/*/${this.target.name}/*/**`;
        }
    }

    private buildPluginOutputs(version: Version): TreeNode[] {
        // Files in the `outputs` directory follow the pattern:
        // .build/plugins/outputs/buildtoolplugin/<target-name>/destination/<build-tool-plugin-name>/*
        // This glob will capture all the files in the outputs directory for this target.
        const pattern = this.buildToolGlobPattern(version);
        const base = this.folder.folder.fsPath.replace(/\\/g, "/");
        const depth = version.isGreaterThanOrEqual(this.newPluginLayoutVersion) ? 4 : 3;
        const matches = glob.sync(pattern, { onlyFiles: false, cwd: base, deep: depth });
        return matches.map(filePath => {
            const pluginName = path.basename(filePath);
            return new HeaderNode(
                `${this.target.name}-${pluginName}`,
                `${pluginName} - Generated Files`,
                "debug-disconnect",
                () =>
                    getChildren(
                        filePath,
                        excludedFilesForProjectPanelExplorer(),
                        this.target.path,
                        this.fs
                    )
            );
        });
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

class ErrorNode {
    constructor(
        public name: string,
        private folder: vscode.Uri
    ) {}

    get path(): string {
        return "";
    }

    toTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.None);
        item.id = `error-${this.folder.fsPath}`;
        item.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
        item.contextValue = "error";
        item.accessibilityInformation = { label: this.name };
        item.tooltip =
            "Could not build the Package.swift, fix the error to refresh the project panel";

        item.command = {
            command: "swift.openManifest",
            arguments: [this.folder],
            title: "Open Manifest",
        };
        return item;
    }

    getChildren(): Promise<TreeNode[]> {
        return Promise.resolve([]);
    }
}

/**
 * A node in the Package Dependencies {@link vscode.TreeView TreeView}.
 *
 * Can be either a {@link PackageNode}, {@link FileNode}, {@link TargetNode}, {@link TaskNode}, {@link ErrorNode} or {@link HeaderNode}.
 */
export type TreeNode = PackageNode | FileNode | HeaderNode | TaskNode | TargetNode | ErrorNode;

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
    private lastComputedNodes: TreeNode[] = [];
    private buildPluginOutputWatcher?: vscode.FileSystemWatcher;
    private buildPluginFolderWatcher?: vscode.Disposable;

    onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

    constructor(private workspaceContext: WorkspaceContext) {
        // default context key to false. These will be updated as folders are given focus
        workspaceContext.contextKeys.hasPackage = false;
        workspaceContext.contextKeys.hasExecutableProduct = false;
        workspaceContext.contextKeys.packageHasDependencies = false;

        this.observeTasks(workspaceContext);
    }

    dispose() {
        this.workspaceObserver?.dispose();
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
    }

    observeTasks(ctx: WorkspaceContext) {
        this.disposables.push(new TaskPoller(() => this.didChangeTreeDataEmitter.fire()));

        this.disposables.push(
            vscode.tasks.onDidStartTask(e => {
                const taskId = e.execution.task.detail ?? e.execution.task.name;
                this.activeTasks.add(taskId);
                this.workspaceContext.logger.info(
                    `Project panel updating after task ${taskId} has started`
                );
                this.didChangeTreeDataEmitter.fire();
            }),
            vscode.tasks.onDidEndTask(e => {
                const taskId = e.execution.task.detail ?? e.execution.task.name;
                this.activeTasks.delete(taskId);
                this.workspaceContext.logger.info(
                    `Project panel updating after task ${taskId} has ended`
                );
                this.didChangeTreeDataEmitter.fire();
            }),
            ctx.onDidStartBuild(e => {
                if (e.launchConfig.runType === "snippet") {
                    this.activeTasks.add(snippetTaskName(e.targetName));
                } else {
                    this.activeTasks.add(e.targetName);
                }
                this.workspaceContext.logger.info("Project panel updating after build has started");
                this.didChangeTreeDataEmitter.fire();
            }),
            ctx.onDidFinishBuild(e => {
                if (e.launchConfig.runType === "snippet") {
                    this.activeTasks.delete(snippetTaskName(e.targetName));
                } else {
                    this.activeTasks.delete(e.targetName);
                }
                this.workspaceContext.logger.info(
                    "Project panel updating after build has finished"
                );
                this.didChangeTreeDataEmitter.fire();
            }),
            ctx.onDidStartTests(e => {
                for (const target of e.targets) {
                    this.activeTasks.add(testTaskName(target));
                }
                this.workspaceContext.logger.info("Project panel updating on test run start");
                this.didChangeTreeDataEmitter.fire();
            }),
            ctx.onDidFinishTests(e => {
                for (const target of e.targets) {
                    this.activeTasks.delete(testTaskName(target));
                }
                this.workspaceContext.logger.info(
                    "Project panel updating after test run has finished"
                );
                this.didChangeTreeDataEmitter.fire();
            })
        );

        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (
                    e.affectsConfiguration("files.exclude") ||
                    e.affectsConfiguration("swift.excludePathsFromPackageDependencies")
                ) {
                    this.workspaceContext.logger.info(
                        "Project panel updating due to configuration changes"
                    );
                    this.didChangeTreeDataEmitter.fire();
                }
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
                        this.watchBuildPluginOutputs(folder);
                        treeView.title = `Swift Project (${folder.name})`;
                        this.workspaceContext.logger.info(
                            `Project panel updating, focused folder ${folder.name}`
                        );
                        this.didChangeTreeDataEmitter.fire();
                        break;
                    case FolderOperation.unfocus:
                        treeView.title = `Swift Project`;
                        this.workspaceContext.logger.info(
                            `Project panel updating, unfocused folder`
                        );
                        this.didChangeTreeDataEmitter.fire();
                        break;
                    case FolderOperation.workspaceStateUpdated:
                    case FolderOperation.resolvedUpdated:
                    case FolderOperation.packageViewUpdated:
                    case FolderOperation.pluginsUpdated:
                        if (!folder) {
                            this.workspaceContext.logger.info(
                                `Project panel cannot update, "${operation}" event was provided with no folder.`
                            );
                            return;
                        }
                        if (folder === this.workspaceContext.currentFolder) {
                            this.workspaceContext.logger.info(
                                `Project panel updating, "${operation}" for folder ${folder.name}`
                            );
                            this.didChangeTreeDataEmitter.fire();
                        }
                }
            }
        );
    }

    watchBuildPluginOutputs(folderContext: FolderContext) {
        if (this.buildPluginOutputWatcher) {
            this.buildPluginOutputWatcher.dispose();
        }
        if (this.buildPluginFolderWatcher) {
            this.buildPluginFolderWatcher.dispose();
        }

        const fire = () => this.didChangeTreeDataEmitter.fire();
        const buildPath = path.join(folderContext.folder.fsPath, ".build/plugins/outputs");
        this.buildPluginFolderWatcher = watchForFolder(
            buildPath,
            () => {
                this.buildPluginOutputWatcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(buildPath, "{*,*/*}")
                );
                this.buildPluginOutputWatcher.onDidCreate(fire);
                this.buildPluginOutputWatcher.onDidDelete(fire);
                this.buildPluginOutputWatcher.onDidChange(fire);
            },
            () => {
                this.buildPluginOutputWatcher?.dispose();
                fire();
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

        if (!element && folderContext.hasResolveErrors) {
            return [
                new ErrorNode("Error Parsing Package.swift", folderContext.folder),
                ...this.lastComputedNodes,
            ];
        }
        const nodes = await this.computeChildren(folderContext, element);

        // If we're fetching the root nodes then save them in case we have an error later,
        // in which case we show the ErrorNode along with the last known good nodes.
        if (!element) {
            this.lastComputedNodes = nodes;
        }
        return nodes;
    }

    async computeChildren(folderContext: FolderContext, element?: TreeNode): Promise<TreeNode[]> {
        if (element) {
            return element.getChildren();
        }

        const dependencies = await this.dependencies();
        const snippets = await this.snippets();
        const commands = await this.commands();

        // TODO: Control ordering
        return [
            ...(dependencies.length > 0
                ? [
                      new HeaderNode(
                          "dependencies",
                          "Dependencies",
                          "circuit-board",
                          this.dependencies.bind(this)
                      ),
                  ]
                : []),
            new HeaderNode("targets", "Targets", "book", this.targets.bind(this)),
            new HeaderNode(
                "tasks",
                "Tasks",
                "debug-continue-small",
                this.tasks.bind(this, folderContext)
            ),
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

    private async dependencies(): Promise<TreeNode[]> {
        const folderContext = this.workspaceContext.currentFolder;
        if (!folderContext) {
            return [];
        }
        this.workspaceContext.logger.info("Project panel refreshing dependencies");
        const pkg = folderContext.swiftPackage;
        const rootDeps = await pkg.rootDependencies;

        rootDeps.forEach(dep => {
            this.workspaceContext.logger.info(`\tAdding dependency: ${dep.identity}`);
        });

        if (this.workspaceContext.contextKeys.flatDependenciesList) {
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

            const allDeps = gatherChildren(rootDeps);
            return allDeps.map(dependency => new PackageNode(dependency, () => []));
        } else {
            const childDeps = pkg.childDependencies.bind(pkg);
            return rootDeps.map(dep => new PackageNode(dep, childDeps));
        }
    }

    private async targets(): Promise<TreeNode[]> {
        const folderContext = this.workspaceContext.currentFolder;
        if (!folderContext) {
            return [];
        }
        const targetSort = (node: TargetNode) => `${node.target.type}-${node.name}`;
        const targets = await folderContext.swiftPackage.targets;
        // Snipepts are shown under the Snippets header
        return targets
            .filter(target => target.type !== "snippet")
            .map(target => new TargetNode(target, folderContext, this.activeTasks))
            .sort((a, b) => targetSort(a).localeCompare(targetSort(b)));
    }

    private async tasks(folderContext: FolderContext): Promise<TaskNode[]> {
        const tasks = await vscode.tasks.fetchTasks({ type: "swift" });

        return (
            tasks
                // Plugin tasks are shown under the Commands header
                .filter(task => {
                    const platform: TaskPlatformSpecificConfig | undefined =
                        getPlatformConfig(task);
                    return (
                        !task.definition.cwd ||
                        resolveTaskCwd(task, platform?.cwd ?? task.definition.cwd) ===
                            folderContext.folder.fsPath
                    );
                })
                .map(
                    (task, i) =>
                        new TaskNode(
                            "task",
                            `${task.definition.cwd}-${task.name}-${task.detail ?? ""}-${i}`,
                            task.name,
                            this.activeTasks.has(task.detail ?? task.name)
                        )
                )
                .sort((a, b) => a.name.localeCompare(b.name))
        );
    }

    private async commands(): Promise<TreeNode[]> {
        const provider = this.workspaceContext.pluginProvider;
        const tasks = await provider.provideTasks(new vscode.CancellationTokenSource().token);
        return tasks
            .map(
                (task, i) =>
                    new TaskNode(
                        "command",
                        `${task.definition.cwd}-${task.name}-${task.detail ?? ""}-${i}`,
                        task.name,
                        this.activeTasks.has(task.detail ?? task.name)
                    )
            )
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private async snippets(): Promise<TreeNode[]> {
        const folderContext = this.workspaceContext.currentFolder;
        if (!folderContext) {
            return [];
        }
        const targets = await folderContext.swiftPackage.targets;
        return targets
            .filter(target => target.type === "snippet")
            .flatMap(target => new TargetNode(target, folderContext, this.activeTasks))
            .sort((a, b) => a.name.localeCompare(b.name));
    }
}

/*
 * A simple task poller that checks for changes in the tasks every 5 seconds.
 * This is a workaround for the lack of an event when tasks are added or removed.
 */
class TaskPoller implements vscode.Disposable {
    private previousTasks: SwiftTask[] = [];
    private timeout?: NodeJS.Timeout;
    private static POLL_INTERVAL = 5000;

    constructor(private onTasksChanged: () => void) {
        void this.pollTasks();
    }

    private async pollTasks() {
        try {
            const tasks = (await vscode.tasks.fetchTasks({ type: "swift" })) as SwiftTask[];
            const tasksChanged =
                tasks.length !== this.previousTasks.length ||
                tasks.some((task, i) => {
                    const prev = this.previousTasks[i];
                    const c1 = task.execution.command;
                    const c2 = prev.execution.command;
                    return (
                        !prev ||
                        task.name !== prev.name ||
                        task.source !== prev.source ||
                        task.definition.cwd !== prev.definition.cwd ||
                        task.detail !== prev.detail ||
                        c1 !== c2
                    );
                });
            if (tasksChanged) {
                this.previousTasks = tasks;
                this.onTasksChanged();
            }
        } catch {
            // ignore errors
        }
        this.timeout = setTimeout(() => this.pollTasks(), TaskPoller.POLL_INTERVAL);
    }

    dispose() {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }
    }
}

/**
 * Polls for the existence of a folder at the given path every 2.5 seconds.
 * Notifies via the provided callbacks when the folder becomes available or is deleted.
 */
function watchForFolder(
    folderPath: string,
    onAvailable: () => void,
    onDeleted: () => void
): vscode.Disposable {
    const POLL_INTERVAL = 2500;
    let folderExists = existsSync(folderPath);

    if (folderExists) {
        onAvailable();
    }

    const interval = setInterval(() => {
        const nowExists = existsSync(folderPath);
        if (nowExists && !folderExists) {
            folderExists = true;
            onAvailable();
        } else if (!nowExists && folderExists) {
            folderExists = false;
            onDeleted();
        }
    }, POLL_INTERVAL);

    return {
        dispose: () => clearInterval(interval),
    };
}
