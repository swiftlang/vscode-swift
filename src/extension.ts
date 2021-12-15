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
import * as commands from './commands';
import * as debug from './debug';
import { PackageDependenciesProvider } from './PackageDependencyProvider';
import { SwiftTaskProvider } from './SwiftTaskProvider';
import { WorkspaceContext } from './WorkspaceContext';
import { activate as activateSourceKitLSP } from './sourcekit-lsp/extension';

/**
 * Activate the extension. This is the main entry point.
 */
export async function activate(context: vscode.ExtensionContext) {
	console.debug('Activating Swift for Visual Studio Code...');

	await activateSourceKitLSP(context);

	const workspaceContext = new WorkspaceContext(context);
	const onWorkspaceChange = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
		if (workspaceContext === undefined) { console.log("Trying to run onDidChangeWorkspaceFolders on deleted context"); return; }
		workspaceContext.onDidChangeWorkspaceFolders(event);
	});

	// Register commands.
	const taskProvider = vscode.tasks.registerTaskProvider('swift', new SwiftTaskProvider(workspaceContext));
	commands.register(workspaceContext);

	// observer for logging workspace folder addition/removal
	const logObserver = workspaceContext.observerFolders((folderContext, operation) => {
		workspaceContext.outputChannel.log(`${operation}: ${folderContext.folder.uri.fsPath}`, folderContext.folder.name);
	});

	// observer that will add dependency view based on whether a root workspace folder has been added
	const addDependencyViewObserver = workspaceContext.observerFolders((folder, operation) => {
		if (folder.isRootFolder && operation === 'add') {
			const dependenciesProvider = new PackageDependenciesProvider(folder);
			const dependenciesView = vscode.window.createTreeView('packageDependencies', {
				treeDataProvider: dependenciesProvider,
				showCollapseAll: true
			});
			context.subscriptions.push(dependenciesView);
		}
	});

	// observer that will resolve package for root folder
	const resolvePackageObserver = workspaceContext.observerFolders(async (folder, operation) => {
		if (folder.isRootFolder && operation === 'add') {
			// Create launch.json files based on package description. 
			await debug.makeDebugConfigurations(folder);
			await commands.resolveDependencies(workspaceContext);
		}
	});

	// add workspace folders, already loaded
	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			await workspaceContext.addFolder(folder);
		}
	}

	// Register any disposables for cleanup when the extension deactivates.
	context.subscriptions.push(resolvePackageObserver, addDependencyViewObserver, logObserver, taskProvider, onWorkspaceChange, workspaceContext);
}

/**
 * Deactivate the extension.
 * 
 * Any disposables registered in `context.subscriptions` will be automatically
 * disposed of, so there's nothing left to do here.
 */
export function deactivate() {
	return;
}

