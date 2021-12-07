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
import commands from './commands';
import { PackageDependenciesProvider } from './PackageDependencyProvider';
import { PackageWatcher } from './PackageWatcher';
import { SwiftTaskProvider } from './SwiftTaskProvider';
import { SwiftContext } from './SwiftContext';
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

	let ctx = await SwiftContext.create(workspaceRoot, context);

	// Register tasks and commands.
	const taskProvider = vscode.tasks.registerTaskProvider('swift', new SwiftTaskProvider(ctx));
	commands.register(context);

	// Create the Package Dependencies view.
	const dependenciesProvider = new PackageDependenciesProvider(workspaceRoot);
	const dependenciesView = vscode.window.createTreeView('packageDependencies', {
		treeDataProvider: dependenciesProvider,
		showCollapseAll: true
	});

	// Watch for changes to Package.swift and Package.resolved.
	const packageWatcher = new PackageWatcher(workspaceRoot, ctx);
	packageWatcher.install();

	// Initialize the context keys and trigger a resolve task if needed.
	packageWatcher.handlePackageChange();

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

