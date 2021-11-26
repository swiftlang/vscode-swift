import * as vscode from 'vscode';
import { pathExists } from './utilities';
import { SwiftTaskProvider } from './SwiftTaskProvider';

export async function activate(context: vscode.ExtensionContext) {
	console.debug('Activating Swift for Visual Studio Code...');

	// Check if we have a workspace folder open.
	// This only support single-root workspaces.
	let workspaceRoot: string | undefined;
	if (vscode.workspace.workspaceFolders) {
		workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
	}

	// Features past this point require a workspace folder containing a package.
	// We could improve this one-time check by creating a watcher for Package.swift instead.
	if (workspaceRoot && await pathExists(workspaceRoot, 'Package.swift')) {
		vscode.commands.executeCommand('setContext', 'swift.hasPackage', true);
	} else {
		return;
	}

	vscode.tasks.registerTaskProvider('swift', new SwiftTaskProvider(workspaceRoot));
}

export function deactivate() {}
