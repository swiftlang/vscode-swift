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

import * as vscode from "vscode";
import * as commands from "./commands";
import * as debug from "./debug";
import { PackageDependenciesProvider } from "./PackageDependencyProvider";
import { SwiftTaskProvider } from "./SwiftTaskProvider";
import { FolderEvent, WorkspaceContext } from "./WorkspaceContext";

/**
 * Activate the extension. This is the main entry point.
 */
export async function activate(context: vscode.ExtensionContext) {
    console.debug("Activating Swift for Visual Studio Code...");

    const workspaceContext = new WorkspaceContext(context);
    context.subscriptions.push(workspaceContext);

    // report swift version and throw error
    await workspaceContext.reportSwiftVersion();

    // setup swift version of LLDB. Don't await on this as it can run in the background
    workspaceContext.setLLDBVersion();

    // listen for workspace folder changes and active text editor changes
    workspaceContext.setupEventListeners();

    // Register commands.
    const taskProvider = vscode.tasks.registerTaskProvider(
        "swift",
        new SwiftTaskProvider(workspaceContext)
    );
    commands.register(workspaceContext);

    // observer for logging workspace folder addition/removal
    const logObserver = workspaceContext.observeFolders((folderContext, event) => {
        workspaceContext.outputChannel.log(
            `${event}: ${folderContext.folder.uri.fsPath}`,
            folderContext.folder.name
        );
    });

    // dependency view
    const dependenciesProvider = new PackageDependenciesProvider(workspaceContext);
    const dependenciesView = vscode.window.createTreeView("packageDependencies", {
        treeDataProvider: dependenciesProvider,
        showCollapseAll: true,
    });

    // observer that will resolve package and build launch configurations
    const resolvePackageObserver = workspaceContext.observeFolders(async (folder, event) => {
        switch (event) {
            case FolderEvent.add:
            case FolderEvent.packageUpdated:
                // Create launch.json files based on package description.
                debug.makeDebugConfigurations(folder);
                if (folder.swiftPackage.foundPackage) {
                    commands.resolveFolderDependencies(folder);
                }
                break;

            case FolderEvent.resolvedUpdated:
                if (folder.swiftPackage.foundPackage) {
                    commands.resolveFolderDependencies(folder);
                }
        }
    });

    // add workspace folders, already loaded
    if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            await workspaceContext.addFolder(folder);
        }
    }

    // Register any disposables for cleanup when the extension deactivates.
    context.subscriptions.push(
        resolvePackageObserver,
        dependenciesView,
        dependenciesProvider,
        logObserver,
        taskProvider
    );
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
