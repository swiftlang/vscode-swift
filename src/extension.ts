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
import { PackageDependenciesProvider } from './PackageDependencyProvider';
import { PackageWatcher } from './PackageWatcher';
import { SwiftTaskProvider } from './SwiftTaskProvider';
import { WorkspaceContext } from './WorkspaceContext';
import { activate as activateSourceKitLSP } from './sourcekit-lsp/extension';

/**
 * Activate the extension. This is the main entry point.
 */
export async function activate(context: vscode.ExtensionContext) {
	console.debug('Activating Swift for Visual Studio Code...');

	await activateSourceKitLSP(context);

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

	let workspaceContext = new WorkspaceContext(context);
	if (vscode.workspace.workspaceFolders !== undefined) {
		for (const folder of vscode.workspace.workspaceFolders) {
			workspaceContext.addFolder(folder);
		}
	}

	let listener = workspaceContext.observerFolders((folder, operation) => {
		console.log(`${operation}: ${folder.rootFolder.uri.fsPath}`);
	});

	// Register tasks and commands.
	const taskProvider = vscode.tasks.registerTaskProvider('swift', new SwiftTaskProvider(workspaceContext));
	commands.register(workspaceContext);

	// Create the Package Dependencies view.
	const dependenciesProvider = new PackageDependenciesProvider(ctx);
	const dependenciesView = vscode.window.createTreeView('packageDependencies', {
		treeDataProvider: dependenciesProvider,
		showCollapseAll: true
	});

	// Register any disposables for cleanup when the extension deactivates.
	context.subscriptions.push(taskProvider, dependenciesView, workspaceContext, listener);
}

/**
 * Deactivate the extension.
 * 
 * Any disposables registered in `context.subscriptions` will be automatically
 * disposed of, so there's nothing left to do here.
 */
export function deactivate() {}

