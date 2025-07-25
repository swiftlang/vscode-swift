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

import * as path from "path";
import * as fs from "fs/promises";
import * as vscode from "vscode";
import { FolderContext } from "./FolderContext";
import { FolderOperation, WorkspaceContext } from "./WorkspaceContext";
import { BuildFlags } from "./toolchain/BuildFlags";
import { Version } from "./utilities/version";
import { fileExists } from "./utilities/filesystem";
import { showReloadExtensionNotification } from "./ui/ReloadExtension";

/**
 * Watches for changes to **Package.swift** and **Package.resolved**.
 *
 * Any changes to these files will update the context keys, trigger a `resolve` task,
 * and update the Package Dependencies view.
 */
export class PackageWatcher {
    private packageFileWatcher?: vscode.FileSystemWatcher;
    private resolvedChangedDisposable?: vscode.Disposable;
    private resolvedFileWatcher?: vscode.FileSystemWatcher;
    private workspaceStateFileWatcher?: vscode.FileSystemWatcher;
    private snippetWatcher?: vscode.FileSystemWatcher;
    private swiftVersionFileWatcher?: vscode.FileSystemWatcher;
    private currentVersion?: Version;

    constructor(
        private folderContext: FolderContext,
        private workspaceContext: WorkspaceContext
    ) {}

    /**
     * Creates and installs {@link vscode.FileSystemWatcher file system watchers} for
     * **Package.swift** and **Package.resolved**.
     */
    async install() {
        this.packageFileWatcher = this.createPackageFileWatcher();
        this.resolvedFileWatcher = this.createResolvedFileWatcher();
        this.workspaceStateFileWatcher = await this.createWorkspaceStateFileWatcher();
        this.snippetWatcher = this.createSnippetFileWatcher();
        this.swiftVersionFileWatcher = await this.createSwiftVersionFileWatcher();
    }

    /**
     * Disposes the {@link vscode.FileSystemWatcher file system watchers}
     * when the extension deactivates.
     */
    dispose() {
        this.packageFileWatcher?.dispose();
        this.resolvedChangedDisposable?.dispose();
        this.resolvedFileWatcher?.dispose();
        this.workspaceStateFileWatcher?.dispose();
        this.snippetWatcher?.dispose();
        this.swiftVersionFileWatcher?.dispose();
    }

    private createPackageFileWatcher(): vscode.FileSystemWatcher {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.folderContext.folder, "Package.swift")
        );
        watcher.onDidCreate(async () => await this.handlePackageSwiftChange());
        watcher.onDidChange(async () => await this.handlePackageSwiftChange());
        watcher.onDidDelete(async () => await this.handlePackageSwiftChange());
        return watcher;
    }

    private createResolvedFileWatcher(): vscode.FileSystemWatcher {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.folderContext.folder, "Package.resolved"),
            // https://github.com/swiftlang/vscode-swift/issues/1571
            // We can ignore create because that would be seemingly from a Package.resolved
            // and will ignore delete as we don't know the reason behind. By still listening
            // for change
            true,
            false,
            true
        );
        this.resolvedChangedDisposable = watcher.onDidChange(
            async () => await this.handlePackageResolvedChange()
        );
        return watcher;
    }

    private async createWorkspaceStateFileWatcher(): Promise<vscode.FileSystemWatcher> {
        const uri = vscode.Uri.joinPath(
            vscode.Uri.file(
                BuildFlags.buildDirectoryFromWorkspacePath(this.folderContext.folder.fsPath, true)
            ),
            "workspace-state.json"
        );
        const watcher = vscode.workspace.createFileSystemWatcher(uri.fsPath);
        watcher.onDidCreate(async () => await this.handleWorkspaceStateChange());
        watcher.onDidChange(async () => await this.handleWorkspaceStateChange());
        watcher.onDidDelete(async () => await this.handleWorkspaceStateChange());

        if (await fileExists(uri.fsPath)) {
            await this.handleWorkspaceStateChange();
        }

        return watcher;
    }

    private createSnippetFileWatcher(): vscode.FileSystemWatcher {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.folderContext.folder, "Snippets/*.swift")
        );
        watcher.onDidCreate(async () => await this.handlePackageSwiftChange());
        watcher.onDidDelete(async () => await this.handlePackageSwiftChange());
        return watcher;
    }

    private async createSwiftVersionFileWatcher(): Promise<vscode.FileSystemWatcher> {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.folderContext.folder, ".swift-version")
        );
        watcher.onDidCreate(async () => await this.handleSwiftVersionFileChange());
        watcher.onDidChange(async () => await this.handleSwiftVersionFileChange());
        watcher.onDidDelete(async () => await this.handleSwiftVersionFileChange());
        this.currentVersion =
            (await this.readSwiftVersionFile()) ?? this.folderContext.toolchain.swiftVersion;
        return watcher;
    }

    async handleSwiftVersionFileChange() {
        const version = await this.readSwiftVersionFile();
        if (version && version.toString() !== this.currentVersion?.toString()) {
            await this.workspaceContext.fireEvent(
                this.folderContext,
                FolderOperation.swiftVersionUpdated
            );
            await showReloadExtensionNotification(
                "Changing the swift toolchain version requires the extension to be reloaded"
            );
        }
        this.currentVersion = version ?? this.folderContext.toolchain.swiftVersion;
    }

    private async readSwiftVersionFile() {
        const versionFile = path.join(this.folderContext.folder.fsPath, ".swift-version");
        try {
            const contents = await fs.readFile(versionFile);
            return Version.fromString(contents.toString().trim());
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                this.workspaceContext.logger.error(
                    `Failed to read .swift-version file at ${versionFile}: ${error}`
                );
            }
        }
        return undefined;
    }

    /**
     * Handles a create or change event for **Package.swift**.
     *
     * This will reload the swift package description, update the
     * launch configuration if required and then resolve the package
     * dependencies.
     */
    async handlePackageSwiftChange() {
        // Load SwiftPM Package.swift description
        await this.folderContext.reload();
        await this.workspaceContext.fireEvent(this.folderContext, FolderOperation.packageUpdated);
    }

    /**
     * Handles a create or change event for **Package.resolved**.
     *
     * This will resolve any changes in the Package.resolved.
     */
    private async handlePackageResolvedChange() {
        const packageResolvedHash = this.folderContext.swiftPackage.resolved?.fileHash;
        await this.folderContext.reloadPackageResolved();
        // if file contents has changed then send resolve updated message
        if (this.folderContext.swiftPackage.resolved?.fileHash !== packageResolvedHash) {
            await this.workspaceContext.fireEvent(
                this.folderContext,
                FolderOperation.resolvedUpdated
            );
        }
    }

    /**
     * Handles a create or change event for **.build/workspace-state.json**.
     *
     * This will resolve any changes in the workspace-state.
     */
    private async handleWorkspaceStateChange() {
        await this.folderContext.reloadWorkspaceState();
        await this.workspaceContext.fireEvent(
            this.folderContext,
            FolderOperation.workspaceStateUpdated
        );
    }
}
