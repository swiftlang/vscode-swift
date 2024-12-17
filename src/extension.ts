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
import * as commands from "./commands";
import * as debug from "./debugger/launch";
import { PackageDependenciesProvider } from "./ui/PackageDependencyProvider";
import { SwiftTaskProvider } from "./tasks/SwiftTaskProvider";
import { FolderOperation, WorkspaceContext } from "./WorkspaceContext";
import { FolderContext } from "./FolderContext";
import { TestExplorer } from "./TestExplorer/TestExplorer";
import { LanguageStatusItems } from "./ui/LanguageStatusItems";
import { getErrorDescription } from "./utilities/utilities";
import { SwiftPluginTaskProvider } from "./tasks/SwiftPluginTaskProvider";
import configuration from "./configuration";
import { Version } from "./utilities/version";
import { getReadOnlyDocumentProvider } from "./ui/ReadOnlyDocumentProvider";
import { registerDebugger } from "./debugger/debugAdapterFactory";
import contextKeys from "./contextKeys";
import { showToolchainError } from "./ui/ToolchainSelection";
import { SwiftToolchain } from "./toolchain/toolchain";
import { SwiftOutputChannel } from "./ui/SwiftOutputChannel";
import { showReloadExtensionNotification } from "./ui/ReloadExtension";
import { checkAndWarnAboutWindowsSymlinks } from "./ui/win32";
import { SwiftEnvironmentVariablesManager, SwiftTerminalProfileProvider } from "./terminal";
import { resolveFolderDependencies } from "./commands/dependencies/resolve";

/**
 * External API as exposed by the extension. Can be queried by other extensions
 * or by the integration test runner for VS Code extensions.
 */
export interface Api {
    workspaceContext?: WorkspaceContext;
    outputChannel: SwiftOutputChannel;
    activate(): Promise<Api>;
    deactivate(): Promise<void>;
}

/**
 * Activate the extension. This is the main entry point.
 */
export async function activate(context: vscode.ExtensionContext): Promise<Api> {
    try {
        const outputChannel = new SwiftOutputChannel("Swift", !process.env["VSCODE_TEST"]);
        outputChannel.log("Activating Swift for Visual Studio Code...");

        checkAndWarnAboutWindowsSymlinks(outputChannel);

        context.subscriptions.push(outputChannel);
        context.subscriptions.push(new SwiftEnvironmentVariablesManager(context));
        context.subscriptions.push(
            vscode.window.registerTerminalProfileProvider(
                "swift.terminalProfile",
                new SwiftTerminalProfileProvider()
            )
        );

        const toolchain: SwiftToolchain | undefined = await SwiftToolchain.create()
            .then(toolchain => {
                toolchain.logDiagnostics(outputChannel);
                contextKeys.createNewProjectAvailable = toolchain.swiftVersion.isGreaterThanOrEqual(
                    new Version(5, 8, 0)
                );
                return toolchain;
            })
            .catch(error => {
                outputChannel.log("Failed to discover Swift toolchain");
                outputChannel.log(error);
                contextKeys.createNewProjectAvailable = false;
                return undefined;
            });

        context.subscriptions.push(...commands.registerToolchainCommands(toolchain));

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                // on toolchain config change, reload window
                if (
                    event.affectsConfiguration("swift.path") &&
                    configuration.path !== toolchain?.swiftFolderPath
                ) {
                    showReloadExtensionNotification(
                        "Changing the Swift path requires Visual Studio Code be reloaded."
                    );
                }
                // on sdk config change, restart sourcekit-lsp
                if (event.affectsConfiguration("swift.SDK")) {
                    // FIXME: There is a bug stopping us from restarting SourceKit-LSP directly.
                    // As long as it's fixed we won't need to reload on newer versions.
                    showReloadExtensionNotification(
                        "Changing the Swift SDK path requires the project be reloaded."
                    );
                }
            })
        );

        if (!toolchain) {
            showToolchainError();
            return {
                workspaceContext: undefined,
                outputChannel,
                activate: () => activate(context),
                deactivate: async () => {
                    await workspaceContext.stop();
                    await deactivate(context);
                },
            };
        }

        const workspaceContext = await WorkspaceContext.create(context, outputChannel, toolchain);
        context.subscriptions.push(...commands.register(workspaceContext));
        context.subscriptions.push(workspaceContext);
        context.subscriptions.push(registerDebugger(workspaceContext));

        // listen for workspace folder changes and active text editor changes
        workspaceContext.setupEventListeners();

        // Register task provider.
        const taskProvider = vscode.tasks.registerTaskProvider(
            "swift",
            new SwiftTaskProvider(workspaceContext)
        );
        // Register swift plugin task provider.
        const pluginTaskProvider = vscode.tasks.registerTaskProvider(
            "swift-plugin",
            new SwiftPluginTaskProvider(workspaceContext)
        );

        const languageStatusItem = new LanguageStatusItems(workspaceContext);

        // swift module document provider
        const swiftModuleDocumentProvider = getReadOnlyDocumentProvider();

        // observer for logging workspace folder addition/removal
        const logObserver = workspaceContext.onDidChangeFolders(({ folder, operation }) => {
            workspaceContext.outputChannel.log(
                `${operation}: ${folder?.folder.fsPath}`,
                folder?.name
            );
        });

        // dependency view
        const dependenciesProvider = new PackageDependenciesProvider(workspaceContext);
        const dependenciesView = vscode.window.createTreeView("packageDependencies", {
            treeDataProvider: dependenciesProvider,
            showCollapseAll: true,
        });
        dependenciesProvider.observeFolders(dependenciesView);

        // observer that will resolve package and build launch configurations
        const resolvePackageObserver = workspaceContext.onDidChangeFolders(
            async ({ folder, operation, workspace }) => {
                // function called when a folder is added. I broke this out so we can trigger it
                // without having to await for it.
                async function folderAdded(folder: FolderContext, workspace: WorkspaceContext) {
                    if (
                        !configuration.folder(folder.workspaceFolder).disableAutoResolve ||
                        configuration.backgroundCompilation
                    ) {
                        // if background compilation is set then run compile at startup unless
                        // this folder is a sub-folder of the workspace folder. This is to avoid
                        // kicking off compile for multiple projects at the same time
                        if (
                            configuration.backgroundCompilation &&
                            folder.workspaceFolder.uri === folder.folder
                        ) {
                            await folder.backgroundCompilation.runTask();
                        } else {
                            await resolveFolderDependencies(folder, true);
                        }
                        if (
                            workspace.toolchain.swiftVersion.isGreaterThanOrEqual(
                                new Version(5, 6, 0)
                            )
                        ) {
                            workspace.statusItem.showStatusWhileRunning(
                                `Loading Swift Plugins (${FolderContext.uriName(
                                    folder.workspaceFolder.uri
                                )})`,
                                async () => {
                                    await folder.loadSwiftPlugins();
                                    workspace.updatePluginContextKey();
                                }
                            );
                        }
                    }
                }
                if (!folder) {
                    return;
                }
                switch (operation) {
                    case FolderOperation.add:
                        // Create launch.json files based on package description.
                        debug.makeDebugConfigurations(folder);
                        if (folder.swiftPackage.foundPackage) {
                            // do not await for this, let packages resolve in parallel
                            folderAdded(folder, workspace);
                        }
                        break;

                    case FolderOperation.packageUpdated:
                        // Create launch.json files based on package description.
                        debug.makeDebugConfigurations(folder);
                        if (
                            folder.swiftPackage.foundPackage &&
                            !configuration.folder(folder.workspaceFolder).disableAutoResolve
                        ) {
                            await resolveFolderDependencies(folder, true);
                        }
                        break;

                    case FolderOperation.resolvedUpdated:
                        if (
                            folder.swiftPackage.foundPackage &&
                            !configuration.folder(folder.workspaceFolder).disableAutoResolve
                        ) {
                            await resolveFolderDependencies(folder, true);
                        }
                }
            }
        );

        const testExplorerObserver = TestExplorer.observeFolders(workspaceContext);

        // setup workspace context with initial workspace folders
        workspaceContext.addWorkspaceFolders();

        // Register any disposables for cleanup when the extension deactivates.
        context.subscriptions.push(
            resolvePackageObserver,
            testExplorerObserver,
            swiftModuleDocumentProvider,
            dependenciesView,
            dependenciesProvider,
            logObserver,
            languageStatusItem,
            pluginTaskProvider,
            taskProvider,
            workspaceContext
        );

        // Mark the extension as activated.
        contextKeys.isActivated = true;

        return {
            workspaceContext,
            outputChannel,
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
        vscode.window.showErrorMessage(`Activating Swift extension failed: ${errorMessage}`);
        throw error;
    }
}

async function deactivate(context: vscode.ExtensionContext): Promise<void> {
    contextKeys.isActivated = false;
    context.subscriptions.forEach(subscription => subscription.dispose());
    context.subscriptions.length = 0;
}
