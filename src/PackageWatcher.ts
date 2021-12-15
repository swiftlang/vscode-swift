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
import * as debug from './debug';
import * as commands from './commands';
import { FolderContext } from './FolderContext';
import { WorkspaceContext } from './WorkspaceContext';
import { WeakReference } from './utilities/WeakReference';

/**
 * Watches for changes to **Package.swift** and **Package.resolved**.
 * 
 * Any changes to these files will update the context keys, trigger a `resolve` task,
 * and update the Package Dependencies view.
 */
export class PackageWatcher {

    private packageFileWatcher?: vscode.FileSystemWatcher;
    private resolvedFileWatcher?: vscode.FileSystemWatcher;
    private contextRef: WeakReference<FolderContext>;
    private workspaceContextRef: WeakReference<WorkspaceContext>;

    constructor(ctx: FolderContext, workspaceContext: WorkspaceContext) {
        this.contextRef = new WeakReference(ctx);
        this.workspaceContextRef = new WeakReference(workspaceContext);
        this.packageFileWatcher = this.createPackageFileWatcher(ctx);
        this.resolvedFileWatcher = this.createResolvedFileWatcher(ctx);
    }

    /**
     * Disposes the {@link vscode.FileSystemWatcher file system watchers}
     * when the extension deactivates.
     */
    dispose() {
        this.packageFileWatcher?.dispose();
        this.resolvedFileWatcher?.dispose();
        this.contextRef.clear();
    }

    private createPackageFileWatcher(ctx: FolderContext): vscode.FileSystemWatcher {
        let folder = ctx.folder;
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, 'Package.swift')
        );
        watcher.onDidCreate(async () => await this.handlePackageSwiftChange());
        watcher.onDidChange(async () => await this.handlePackageSwiftChange());
        watcher.onDidDelete(async () => await this.handlePackageSwiftChange());
        return watcher;
    }

    private createResolvedFileWatcher(ctx: FolderContext): vscode.FileSystemWatcher {
        let folder = ctx.folder;
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, 'Package.resolved')
        );
        watcher.onDidCreate(async () => await this.handlePackageResolvedChange());
        watcher.onDidChange(async () => await this.handlePackageResolvedChange());
        watcher.onDidDelete(async () => await this.handlePackageResolvedChange());
        return watcher;
    }

    /**
     * Handles a create or change event for **Package.swift**.
     * 
     * This will reload the swift package description, update the 
     * launch configuration if required and then resolve the package
     * dependencies.
     */
    async handlePackageSwiftChange() {
        if (this.contextRef.value === undefined) { return; }
        // Load SwiftPM Package.swift description 
        await this.contextRef.value.reload();
        // Create launch.json files based on package description. Run this in parallel
        // with package resolution
        debug.makeDebugConfigurations(this.contextRef.value);
        // if package has dependencies resolve them
        if (
            this.contextRef.value.isRootFolder && 
            this.contextRef.value.swiftPackage.foundPackage &&
            this.workspaceContextRef.value
        ) {
            await commands.resolveDependencies(this.workspaceContextRef.value);
        }
    }

    /**
     * Handles a create or change event for **Package.resolved**.
     * 
     * This will resolve any changes in the Package.resolved.
     */
    private async handlePackageResolvedChange() {
        if (this.contextRef.value === undefined) { return; }
        if (
            this.contextRef.value.isRootFolder && 
            this.contextRef.value.swiftPackage.foundPackage &&
            this.workspaceContextRef.value
        ) {
            await commands.resolveDependencies(this.workspaceContextRef.value);
        }
    }
}
