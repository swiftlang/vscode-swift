import { wrap } from 'module';
import { setFlagsFromString } from 'v8';
import * as vscode from 'vscode';
import commands from './commands';
import contextKeys from './contextKeys';
import { PackageDependenciesProvider } from './PackageDependencyProvider';
import { PackageWatcher } from './PackageWatcher';
import { SwiftTaskProvider } from './SwiftTaskProvider';
import { exec, pathExists } from './utilities';

/**
 * Activate the extension. This is the main entry point.
 */
export async function activate(context: vscode.ExtensionContext) {
	console.debug('Activating Swift for Visual Studio Code...');

	// Check if we have a workspace folder open.
	// This only supports single-root workspaces.
	let workspaceRoot: string | undefined;
	if (vscode.workspace.workspaceFolders) {
		workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
	}

	// Features past this point require a workspace folder.
	if (!workspaceRoot) {
		return;
	}

	// Register tasks and commands.
	const taskProvider = vscode.tasks.registerTaskProvider('swift', new SwiftTaskProvider(workspaceRoot));
	commands.register(context);

	// Create the Package Dependencies view.
	const dependenciesProvider = new PackageDependenciesProvider(workspaceRoot);
	const dependenciesView = vscode.window.createTreeView('packageDependencies', {
		treeDataProvider: dependenciesProvider,
		showCollapseAll: true
	});

	// Watch for changes to Package.swift and Package.resolved.
	const packageWatcher = new PackageWatcher(workspaceRoot);
	packageWatcher.install();

	// Initialize the context keys and trigger a resolve task if needed.
	if (await pathExists(workspaceRoot, 'Package.swift')) {
		packageWatcher.handlePackageChange();
	} else {
		contextKeys.hasPackage = false;
		contextKeys.packageHasDependencies = false;
	}

	// Register any disposables for cleanup when the extension deactivates.
	context.subscriptions.push(taskProvider, dependenciesView, packageWatcher);
}

/**
 * Deactivate the extension.
 * 
 * Any disposables registered in `context.subscriptions` will be automatically
 * disposed of, so there's nothing left to do here.
 */
export function deactivate() {}

export class Package {
	public folder: string
	public package: Object;
	
	public constructor(folder: string) {
		this.folder = folder
		this.package = []
	}

	public async loadPackage() {
		const { stdout } = await exec('swift package describe --type json', { cwd: this.folder });
        this.package = JSON.parse(stdout)		
	}
}
