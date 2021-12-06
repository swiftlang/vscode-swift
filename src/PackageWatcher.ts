import * as vscode from 'vscode';
import commands from './commands';
import contextKeys from './contextKeys';
import { pathExists } from './utilities';
import { Ctx } from './ctx';

/**
 * Watches for changes to **Package.swift** and **Package.resolved**.
 * 
 * Any changes to these files will update the context keys, trigger a `resolve` task,
 * and update the Package Dependencies view.
 */
export class PackageWatcher {

    private packageFileWatcher?: vscode.FileSystemWatcher;
    private resolvedFileWatcher?: vscode.FileSystemWatcher;

    private ctx: Ctx
    private workspaceRoot: string

    constructor(workspaceRoot: string, ctx: Ctx) {
        this.workspaceRoot = workspaceRoot
        this.ctx = ctx
    }

    /**
     * Creates and installs {@link vscode.FileSystemWatcher file system watchers} for
     * **Package.swift** and **Package.resolved**.
     */
    install() {
        this.packageFileWatcher = this.createPackageFileWatcher();
        this.resolvedFileWatcher = this.createResolvedFileWatcher();
    }

    /**
     * Disposes the {@link vscode.FileSystemWatcher file system watchers}
     * when the extension deactivates.
     */
    dispose() {
        this.packageFileWatcher?.dispose();
        this.resolvedFileWatcher?.dispose();
    }

    private createPackageFileWatcher(): vscode.FileSystemWatcher {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, 'Package.swift')
        );
        watcher.onDidCreate(async () => await this.handlePackageChange());
        watcher.onDidChange(async () => await this.handlePackageChange());
        watcher.onDidDelete(() => {
            contextKeys.hasPackage = false;
            contextKeys.packageHasDependencies = false;
        });
        return watcher;
    }

    private createResolvedFileWatcher(): vscode.FileSystemWatcher {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, 'Package.resolved')
        );
        watcher.onDidCreate(async () => await this.handlePackageChange());
        watcher.onDidChange(async () => await this.handlePackageChange());
        watcher.onDidDelete(async () => {
            if (await pathExists(this.workspaceRoot, 'Package.swift')) {
                // Recreate Package.resolved.
                this.handlePackageChange();
            } else {
                contextKeys.hasPackage = false;
                contextKeys.packageHasDependencies = false;
            }
        });
        return watcher;
    }

    /**
     * Handles a create or change event for **Package.swift** and **Package.resolved**.
     * 
     * This will update the context keys and trigger a `resolve` task,
     * which will in turn update the Package Dependencies view.
     */
    async handlePackageChange() {
        contextKeys.hasPackage = true;
        await this.ctx.spmPackage.reload()
        if (this.ctx.spmPackage.dependencies.length > 0) {
            contextKeys.packageHasDependencies = true;
            await commands.resolveDependencies();
        } else {
            contextKeys.packageHasDependencies = false;
        }
    }

    /**
     * Whether this package has any dependencies.
     */
    private packageHasDependencies(): boolean {
        return this.ctx.spmPackage.contents.dependencies.length != 0
    }
}
