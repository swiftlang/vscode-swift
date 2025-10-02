//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
// Use source-map-support to get better stack traces
import "source-map-support/register";

import * as vscode from "vscode";

import { FolderContext } from "./FolderContext";
import { TestExplorer } from "./TestExplorer/TestExplorer";
import { FolderEvent, FolderOperation, WorkspaceContext } from "./WorkspaceContext";
import * as commands from "./commands";
import { resolveFolderDependencies } from "./commands/dependencies/resolve";
import { registerSourceKitSchemaWatcher } from "./commands/generateSourcekitConfiguration";
import configuration, { handleConfigurationChangeEvent } from "./configuration";
import { ContextKeys, createContextKeys } from "./contextKeys";
import { registerDebugger } from "./debugger/debugAdapterFactory";
import * as debug from "./debugger/launch";
import { SwiftLogger } from "./logging/SwiftLogger";
import { SwiftLoggerFactory } from "./logging/SwiftLoggerFactory";
import { SwiftEnvironmentVariablesManager, SwiftTerminalProfileProvider } from "./terminal";
import { SelectedXcodeWatcher } from "./toolchain/SelectedXcodeWatcher";
import { checkForSwiftlyInstallation } from "./toolchain/swiftly";
import { SwiftToolchain } from "./toolchain/toolchain";
import { LanguageStatusItems } from "./ui/LanguageStatusItems";
import { getReadOnlyDocumentProvider } from "./ui/ReadOnlyDocumentProvider";
import { showToolchainError } from "./ui/ToolchainSelection";
import { checkAndWarnAboutWindowsSymlinks } from "./ui/win32";
import { getErrorDescription } from "./utilities/utilities";
import { Version } from "./utilities/version";

/**
 * External API as exposed by the extension. Can be queried by other extensions
 * or by the integration test runner for VS Code extensions.
 */
export interface Api {
    workspaceContext?: WorkspaceContext;
    logger: SwiftLogger;
    activate(): Promise<Api>;
    deactivate(): Promise<void>;
}

/**
 * Activate the extension. This is the main entry point.
 */
export async function activate(context: vscode.ExtensionContext): Promise<Api> {
    try {
        await vscode.workspace.fs.createDirectory(context.logUri);
        const logger = new SwiftLoggerFactory(context.logUri).create(
            "Swift",
            "swift-vscode-extension.log"
        );
        context.subscriptions.push(logger);
        logger.info(
            `Activating Swift for Visual Studio Code ${context.extension.packageJSON.version}...`
        );

        checkAndWarnAboutWindowsSymlinks(logger);

        const contextKeys = createContextKeys();
        const toolchain = await createActiveToolchain(contextKeys, logger);
        checkForSwiftlyInstallation(contextKeys, logger);

        // If we don't have a toolchain, show an error and stop initializing the extension.
        // This can happen if the user has not installed Swift or if the toolchain is not
        // properly configured.
        if (!toolchain) {
            // In order to select a toolchain we need to register the command first.
            const subscriptions = commands.registerToolchainCommands(undefined, logger, undefined);
            const chosenRemediation = await showToolchainError();
            subscriptions.forEach(sub => sub.dispose());

            // If they tried to fix the improperly configured toolchain, re-initialize the extension.
            if (chosenRemediation) {
                return activate(context);
            } else {
                return {
                    workspaceContext: undefined,
                    logger,
                    activate: () => activate(context),
                    deactivate: async () => {
                        await deactivate(context);
                    },
                };
            }
        }

        const workspaceContext = new WorkspaceContext(context, contextKeys, logger, toolchain);
        context.subscriptions.push(workspaceContext);

        context.subscriptions.push(new SwiftEnvironmentVariablesManager(context));
        context.subscriptions.push(SwiftTerminalProfileProvider.register());
        context.subscriptions.push(
            ...commands.registerToolchainCommands(
                toolchain,
                workspaceContext.logger,
                workspaceContext.currentFolder?.folder
            )
        );

        // Watch for configuration changes the trigger a reload of the extension if necessary.
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(
                handleConfigurationChangeEvent(workspaceContext)
            )
        );

        context.subscriptions.push(...commands.register(workspaceContext));
        context.subscriptions.push(registerDebugger(workspaceContext));
        context.subscriptions.push(new SelectedXcodeWatcher(logger));

        // Register task provider.
        context.subscriptions.push(
            vscode.tasks.registerTaskProvider("swift", workspaceContext.taskProvider)
        );

        // Register swift plugin task provider.
        context.subscriptions.push(
            vscode.tasks.registerTaskProvider("swift-plugin", workspaceContext.pluginProvider)
        );

        // Register the language status bar items.
        context.subscriptions.push(new LanguageStatusItems(workspaceContext));

        // swift module document provider
        context.subscriptions.push(getReadOnlyDocumentProvider());

        // observer for logging workspace folder addition/removal
        context.subscriptions.push(
            workspaceContext.onDidChangeFolders(({ folder, operation }) => {
                logger.info(`${operation}: ${folder?.folder.fsPath}`, folder?.name);
            })
        );

        // project panel provider
        const dependenciesView = vscode.window.createTreeView("projectPanel", {
            treeDataProvider: workspaceContext.projectPanel,
            showCollapseAll: true,
        });
        workspaceContext.projectPanel.observeFolders(dependenciesView);

        context.subscriptions.push(dependenciesView);

        // observer that will resolve package and build launch configurations
        context.subscriptions.push(workspaceContext.onDidChangeFolders(handleFolderEvent(logger)));
        context.subscriptions.push(TestExplorer.observeFolders(workspaceContext));

        context.subscriptions.push(registerSourceKitSchemaWatcher(workspaceContext));

        // setup workspace context with initial workspace folders
        void workspaceContext.addWorkspaceFolders();

        // Mark the extension as activated.
        contextKeys.isActivated = true;

        return {
            workspaceContext,
            logger,
            activate: () => activate(context),
            deactivate: async () => {
                await workspaceContext.stop();
                await deactivate(context);
            },
        };
    } catch (error) {
        const errorMessage = getErrorDescription(error);
        // show this error message as the VS Code error message only shows when running
        // the extension through the debugger
        void vscode.window.showErrorMessage(`Activating Swift extension failed: ${errorMessage}`);
        throw error;
    }
}

function handleFolderEvent(logger: SwiftLogger): (event: FolderEvent) => Promise<void> {
    // function called when a folder is added. I broke this out so we can trigger it
    // without having to await for it.
    async function folderAdded(folder: FolderContext, workspace: WorkspaceContext) {
        if (
            !configuration.folder(folder.workspaceFolder).disableAutoResolve ||
            configuration.backgroundCompilation.enabled
        ) {
            // if background compilation is set then run compile at startup unless
            // this folder is a sub-folder of the workspace folder. This is to avoid
            // kicking off compile for multiple projects at the same time
            if (
                configuration.backgroundCompilation.enabled &&
                folder.workspaceFolder.uri === folder.folder
            ) {
                await folder.backgroundCompilation.runTask();
            } else {
                await resolveFolderDependencies(folder, true);
            }

            if (folder.toolchain.swiftVersion.isGreaterThanOrEqual(new Version(5, 6, 0))) {
                void workspace.statusItem.showStatusWhileRunning(
                    `Loading Swift Plugins (${FolderContext.uriName(folder.workspaceFolder.uri)})`,
                    async () => {
                        await folder.loadSwiftPlugins(logger);
                        workspace.updatePluginContextKey();
                        await folder.fireEvent(FolderOperation.pluginsUpdated);
                    }
                );
            }
        }
    }

    return async ({ folder, operation, workspace }) => {
        if (!folder) {
            return;
        }

        switch (operation) {
            case FolderOperation.add:
                // Create launch.json files based on package description.
                await debug.makeDebugConfigurations(folder);
                if (await folder.swiftPackage.foundPackage) {
                    // do not await for this, let packages resolve in parallel
                    void folderAdded(folder, workspace);
                }
                break;

            case FolderOperation.packageUpdated:
                // Create launch.json files based on package description.
                await debug.makeDebugConfigurations(folder);
                if (
                    (await folder.swiftPackage.foundPackage) &&
                    !configuration.folder(folder.workspaceFolder).disableAutoResolve
                ) {
                    await resolveFolderDependencies(folder, true);
                }
                break;

            case FolderOperation.resolvedUpdated:
                if (
                    (await folder.swiftPackage.foundPackage) &&
                    !configuration.folder(folder.workspaceFolder).disableAutoResolve
                ) {
                    await resolveFolderDependencies(folder, true);
                }
        }
    };
}

async function createActiveToolchain(
    contextKeys: ContextKeys,
    logger: SwiftLogger
): Promise<SwiftToolchain | undefined> {
    try {
        const toolchain = await SwiftToolchain.create(undefined, logger);
        toolchain.logDiagnostics(logger);
        contextKeys.updateKeysBasedOnActiveVersion(toolchain.swiftVersion);
        return toolchain;
    } catch (error) {
        logger.error(`Failed to discover Swift toolchain: ${error}`);
        return undefined;
    }
}

async function deactivate(context: vscode.ExtensionContext): Promise<void> {
    const workspaceContext = (context.extension.exports as Api).workspaceContext;
    if (workspaceContext) {
        workspaceContext.contextKeys.isActivated = false;
    }
    context.subscriptions.forEach(subscription => subscription.dispose());
    context.subscriptions.length = 0;
}
