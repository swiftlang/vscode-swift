//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { InternalSwiftExtensionApi } from "../InternalSwiftExtensionApi";
import { FolderOperation } from "../SwiftExtensionApi";
import { FolderEvent, WorkspaceContext } from "../WorkspaceContext";
import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { Disposable } from "../utilities/Disposable";
import { expandPath, isPathInsidePath, searchParentDirectories } from "../utilities/filesystem";
import { Swiftly } from "./swiftly";

/** A {@link vscode.FileSystemWatcher} shared between all folders that search a directory. */
interface DirectoryWatcher {
    watcher: vscode.FileSystemWatcher;
    subscriptions: Disposable[];
    refCount: number;
}

interface WatchedFolder {
    folder: FolderContext;
    /** The list of paths that this folder is watching for .swift-version files in. */
    watchedPaths: string[];
    /** The version resolved from the nearest `.swift-version` file in {@link searchPath}. */
    version: string | undefined;
}

export class SwiftlyToolchainWatcher implements Disposable {
    public static readonly CHECK_INTERVAL = 2000;

    private queuedUpdates: Array<() => void | Promise<void>> = [];
    private isProcessingUpdate: boolean = false;
    private isDisposed: boolean = false;

    private subscriptions: Disposable[] = [];
    private workspaceSubscriptions: Disposable[] = [];
    private directoryWatchers: Map<string, DirectoryWatcher> = new Map();
    private watchedFolders: Map<string, WatchedFolder> = new Map();

    private globalSwiftVersion: string | undefined;
    private interval: NodeJS.Timeout | undefined;

    private get logger(): SwiftLogger {
        return this.api.logger;
    }

    constructor(private api: InternalSwiftExtensionApi) {
        // Deliberately not awaiting this, as we don't want to block the extension activation.
        this.setup().catch(error => {
            this.logger.error(Error("Failed to setup SwiftlyToolchainWatcher", { cause: error }));
        });
    }

    /**
     * Queues an update to the watcher's state.
     *
     * Updates are processed one at a time and in the order that they were queued, so that an
     * update waiting on the file system can't be overtaken by one that was queued after it.
     */
    private enqueueUpdate(update: () => void | Promise<void>): void {
        if (this.isDisposed) {
            return;
        }
        this.queuedUpdates.push(update);
        this.processQueuedUpdates();
    }

    private processQueuedUpdates(): void {
        if (this.isDisposed || this.isProcessingUpdate) {
            return;
        }

        const nextUpdate = this.queuedUpdates.shift();
        if (!nextUpdate) {
            return;
        }

        this.isProcessingUpdate = true;
        void this.runUpdate(nextUpdate);
    }

    private async runUpdate(update: () => void | Promise<void>): Promise<void> {
        try {
            await update();
        } catch (error) {
            this.logger.error(Error("Failed to process queued update", { cause: error }), {
                label: "SwiftlyToolchainWatcher",
            });
        } finally {
            this.isProcessingUpdate = false;
            this.processQueuedUpdates();
        }
    }

    /**
     * Polls Swiftly to check if the global toolchain has been changed.
     */
    private async setup(): Promise<void> {
        this.subscriptions.push(
            this.api.onDidChangeWorkspaceContext(this.handleWorkspaceContextChanged, this),
            vscode.workspace.onDidChangeConfiguration(this.handleConfigurationChanged, this)
        );

        this.globalSwiftVersion = await Swiftly.inUseVersion();
        this.interval = setInterval(() => {
            void this.checkGlobalSwiftlyVersion();
        }, SwiftlyToolchainWatcher.CHECK_INTERVAL);
    }

    private handleConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
        if (
            !event.affectsConfiguration("swift.maxSwiftVersionFileWatchDepth") &&
            !event.affectsConfiguration("swift.ignoreSwiftVersionFile")
        ) {
            return;
        }
        this.enqueueUpdate(() => this.rewatchAllFolders());
    }

    private handleWorkspaceContextChanged(workspaceContext: WorkspaceContext): void {
        this.workspaceSubscriptions.forEach(s => s.dispose());
        this.workspaceSubscriptions = [];
        this.enqueueUpdate(() => {
            this.disposeDirectoryWatchers();
            this.watchedFolders = new Map();
        });
        this.workspaceSubscriptions = [
            workspaceContext.onDidChangeFolders(this.handleFolderContextChanges.bind(this)),
        ];
    }

    /**
     * Finds the version in the nearest `.swift-version` file within the given search path.
     *
     * @param searchPath The directories to search, nearest first.
     * @returns The contents of the nearest `.swift-version` file, or `undefined` if none exist.
     */
    private async resolveSwiftVersion(folder: FolderContext): Promise<string | undefined> {
        const directory = folder.folder.fsPath;
        return searchParentDirectories(directory, async directory => {
            const versionFile = path.join(directory, ".swift-version");
            try {
                return {
                    kind: "stop",
                    value: (await fs.readFile(versionFile, "utf-8")).trim(),
                };
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                    this.logger.error(
                        Error(`Failed to read .swift-version file at ${versionFile}`, {
                            cause: error,
                        })
                    );
                }
            }
            return { kind: "continue" };
        });
    }

    private handleFolderContextChanges({ folder, operation }: FolderEvent): void {
        if (!folder) {
            return;
        }

        switch (operation) {
            case FolderOperation.add:
                this.enqueueUpdate(() => this.addFolder(folder));
                break;
            case FolderOperation.remove:
                this.enqueueUpdate(() => this.removeFolder(folder));
                break;
        }
    }

    private async addFolder(folder: FolderContext): Promise<void> {
        if (this.watchedFolders.has(folder.folder.fsPath)) {
            return;
        }

        const folderConfiguration = configuration.folder(folder.workspaceFolder);
        if (folderConfiguration.ignoreSwiftVersionFile) {
            return;
        }

        const watchedPaths = expandPath(folder.folder.fsPath).slice(
            0,
            folderConfiguration.maxSwiftVersionFileWatchDepth
        );
        watchedPaths.forEach(directory => this.addDirectoryWatcher(directory));
        const version = await this.resolveSwiftVersion(folder);
        this.watchedFolders.set(folder.folder.fsPath, { folder, watchedPaths, version });
    }

    private removeFolder(folder: FolderContext): void {
        const watchedFolder = this.watchedFolders.get(folder.folder.fsPath);
        if (!watchedFolder) {
            return;
        }
        this.watchedFolders.delete(folder.folder.fsPath);
        watchedFolder.watchedPaths.forEach(directory => this.releaseDirectoryWatcher(directory));
    }

    /**
     * Recomputes the search path of every folder in the workspace.
     *
     * Note that the toolchain of a folder is deliberately left alone: widening or narrowing the
     * search path doesn't change the version that Swiftly itself resolves, it only changes how
     * much of the file system we watch for changes.
     */
    private async rewatchAllFolders(): Promise<void> {
        const folders = [...(this.api.workspaceContext?.folders ?? [])];
        this.disposeDirectoryWatchers();
        this.watchedFolders = new Map();
        await Promise.all(
            folders.map(async folder => {
                try {
                    await this.addFolder(folder);
                } catch (error) {
                    this.logger.error(
                        Error(`Failed to watch .swift-version files for ${folder.name}`, {
                            cause: error,
                        })
                    );
                }
            })
        );
    }

    private addDirectoryWatcher(directory: string): void {
        const existing = this.directoryWatchers.get(directory);
        if (existing) {
            existing.refCount += 1;
            return;
        }

        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(directory), ".swift-version")
        );
        const handleChange = () =>
            this.enqueueUpdate(() => this.handleSwiftVersionFileChanged(directory));
        this.directoryWatchers.set(directory, {
            watcher,
            subscriptions: [
                watcher.onDidCreate(handleChange),
                watcher.onDidChange(handleChange),
                watcher.onDidDelete(handleChange),
            ],
            refCount: 1,
        });
    }

    private releaseDirectoryWatcher(directory: string): void {
        const directoryWatcher = this.directoryWatchers.get(directory);
        if (!directoryWatcher) {
            return;
        }
        directoryWatcher.refCount -= 1;
        if (directoryWatcher.refCount > 0) {
            return;
        }
        this.directoryWatchers.delete(directory);
        disposeDirectoryWatcher(directoryWatcher);
    }

    private disposeDirectoryWatchers(): void {
        this.directoryWatchers.forEach(disposeDirectoryWatcher);
        this.directoryWatchers = new Map();
    }

    /**
     * Reloads the toolchain of every folder whose resolved Swift version has changed.
     *
     * A single `.swift-version` file can be shared by many folders, and creating or deleting
     * one can shadow or reveal a `.swift-version` file further up the tree. Both cases are
     * handled by re-resolving the version for each folder that searches this directory.
     *
     * @param directory The directory containing the `.swift-version` file that changed.
     */
    private async handleSwiftVersionFileChanged(directory: string): Promise<void> {
        const affectedFolders = [...this.watchedFolders.values()].filter(({ folder }) =>
            isPathInsidePath(folder.folder.fsPath, directory)
        );
        await Promise.all(
            affectedFolders.map(async watcher => {
                const oldSwiftVersion = watcher.version;
                const newSwiftVersion = await this.resolveSwiftVersion(watcher.folder);
                if (newSwiftVersion === oldSwiftVersion) {
                    return;
                }

                watcher.version = newSwiftVersion;
                if (newSwiftVersion === "") {
                    // An empty file is almost always a write that is still in progress, as
                    // Swiftly.use() creates the file before asking swiftly to populate it.
                    // Record the version so that the real write is still seen as a change, but
                    // don't reload against a file that swiftly would reject.
                    return;
                }
                if (watcher.folder.toolchain.manager !== "swiftly") {
                    return;
                }
                await watcher.folder.reloadToolchain();
            })
        );
    }

    private async checkGlobalSwiftlyVersion(): Promise<void> {
        const oldSwiftVersion = this.globalSwiftVersion;
        const newSwiftVersion = await Swiftly.inUseVersion();
        if (!newSwiftVersion) {
            return;
        }

        this.globalSwiftVersion = newSwiftVersion;
        if (!oldSwiftVersion || newSwiftVersion === oldSwiftVersion) {
            return;
        }

        const toolchainManager = this.api.workspaceContext?.globalToolchain.manager ?? "swiftly";
        if (toolchainManager !== "swiftly") {
            return;
        }
        this.api.reloadWorkspaceContext();
    }

    dispose(): void {
        this.isDisposed = true;
        this.queuedUpdates = [];
        this.subscriptions.forEach(s => s.dispose());
        this.subscriptions = [];
        this.workspaceSubscriptions.forEach(s => s.dispose());
        this.workspaceSubscriptions = [];
        this.disposeDirectoryWatchers();
        this.watchedFolders = new Map();
        clearInterval(this.interval);
        this.interval = undefined;
    }
}

function disposeDirectoryWatcher({ watcher, subscriptions }: DirectoryWatcher): void {
    subscriptions.forEach(s => s.dispose());
    watcher.dispose();
}
