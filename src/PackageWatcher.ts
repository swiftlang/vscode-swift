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

/**
 * Watches for changes to **Package.swift** and **Package.resolved**.
 *
 * Any changes to these files will update the context keys, trigger a `resolve` task,
 * and update the Package Dependencies view.
 */
export class PackageWatcher {
    private packageFileWatcher?: vscode.FileSystemWatcher;
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
            new vscode.RelativePattern(this.folderContext.folder, "Package.resolved")
        );
        watcher.onDidCreate(async () => await this.handlePackageResolvedChange());
        watcher.onDidChange(async () => await this.handlePackageResolvedChange());
        watcher.onDidDelete(async () => await this.handlePackageResolvedChange());
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

        const fileExists = await fs
            .access(uri.fsPath)
            .then(() => true)
            .catch(() => false);

        if (fileExists) {
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
        try {
            const version = await this.readSwiftVersionFile();
            if (version && version.toString() !== this.currentVersion?.toString()) {
                this.workspaceContext.fireEvent(
                    this.folderContext,
                    FolderOperation.swiftVersionUpdated
                );
            }
            this.currentVersion = version ?? this.folderContext.toolchain.swiftVersion;
        } catch {
            // do nothing
        }
    }

    private async readSwiftVersionFile() {
        const versionFile = path.join(this.folderContext.folder.fsPath, ".swift-version");
        try {
            const contents = await fs.readFile(versionFile);
            return Version.fromString(contents.toString().trim());
        } catch {
            return undefined;
        }
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
        this.workspaceContext.fireEvent(this.folderContext, FolderOperation.packageUpdated);
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
            this.workspaceContext.fireEvent(this.folderContext, FolderOperation.resolvedUpdated);
        }
    }

    /**
     * Handles a create or change event for **.build/workspace-state.json**.
     *
     * This will resolve any changes in the workspace-state.
     */
    private async handleWorkspaceStateChange() {
        await this.folderContext.reloadWorkspaceState();
        this.workspaceContext.fireEvent(this.folderContext, FolderOperation.workspaceStateUpdated);
    }
}
