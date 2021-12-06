import * as vscode from 'vscode';
import commands from './commands';
import contextKeys from './contextKeys';
import { exec, pathExists } from './utilities';
import { PackageDependenciesProvider } from './PackageDependencyProvider';
/**
 * Watches for changes to **Package.swift** and **Package.resolved**.
 * 
 * Any changes to these files will update the context keys, trigger a `resolve` task,
 * and update the Package Dependencies view.
 */
export class PackageWatcher {

    private packageFileWatcher?: vscode.FileSystemWatcher;
    private resolvedFileWatcher?: vscode.FileSystemWatcher;

    constructor(private workspaceRoot: string) { }

    /**
     * Creates and installs {@link vscode.FileSystemWatcher file system watchers} for
     * **Package.swift** and **Package.resolved**.
     */
    install(dependencyTree: PackageDependenciesProvider) {
        this.packageFileWatcher = this.createPackageFileWatcher();
        this.resolvedFileWatcher = this.createResolvedFileWatcher(dependencyTree);
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
        watcher.onDidCreate(async () => await this.handlePackageSwiftChange());
        watcher.onDidChange(async () => await this.handlePackageSwiftChange());
        watcher.onDidDelete(() => {
            contextKeys.hasPackage = false;
            contextKeys.packageHasDependencies = false;
        });
        return watcher;
    }

    private createResolvedFileWatcher(dependencyTree: PackageDependenciesProvider): vscode.FileSystemWatcher {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, 'Package.resolved')
        );
        watcher.onDidCreate(async () => dependencyTree.triggerRebuild());
        watcher.onDidChange(async () => dependencyTree.triggerRebuild());
        watcher.onDidDelete(async () => {
            if (await pathExists(this.workspaceRoot, 'Package.swift')) {
                // Recreate Package.resolved.
                this.handlePackageSwiftChange();
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
     async handlePackageSwiftChange() {
        contextKeys.hasPackage = true;
        if (await this.packageHasDependencies()) {
            contextKeys.packageHasDependencies = true;
            await commands.resolveDependencies();
        } else {
            contextKeys.packageHasDependencies = false;
        }
    }

    /**
     * Handles a create or change event for **Package.swift** and **Package.resolved**.
     * 
     * This will update the context keys and trigger a `resolve` task,
     * which will in turn update the Package Dependencies view.
     */
     async handlePackageResolvedChange() {
       // commands.rebuildDependencyGraph()
    }

    /**
     * Whether this package has any dependencies.
     */
    private async packageHasDependencies(): Promise<boolean> {
        const { stdout } = await exec('swift package describe --type json', { cwd: this.workspaceRoot });
        return JSON.parse(stdout).dependencies.length !== 0;
    }
}
