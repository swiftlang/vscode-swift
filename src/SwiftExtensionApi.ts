//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as vscode from "vscode";

import { FolderContext } from "./FolderContext";
import { TestExplorer } from "./TestExplorer/TestExplorer";
import { FolderEvent, FolderOperation, WorkspaceContext } from "./WorkspaceContext";
import { registerCommands } from "./commands";
import { resolveFolderDependencies } from "./commands/dependencies/resolve";
import { registerSourceKitSchemaWatcher } from "./commands/generateSourcekitConfiguration";
import configuration from "./configuration";
import { ContextKeys, createContextKeys } from "./contextKeys";
import { registerDebugger } from "./debugger/debugAdapterFactory";
import { makeDebugConfigurations } from "./debugger/launch";
import { Api } from "./extension";
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

type State = (
    | {
          type: "initializing";
          promise: Promise<WorkspaceContext>;
          cancellation: vscode.CancellationTokenSource;
      }
    | { type: "active"; context: WorkspaceContext; subscriptions: vscode.Disposable[] }
    | { type: "failed"; error: Error }
) & { activatedBy: Error };

export class SwiftExtensionApi implements Api {
    private state?: State;

    get workspaceContext(): WorkspaceContext | undefined {
        if (this.state?.type !== "active") {
            return undefined;
        }
        return this.state.context;
    }

    contextKeys: ContextKeys;

    logger: SwiftLogger;

    constructor(private readonly extensionContext: vscode.ExtensionContext) {
        this.contextKeys = createContextKeys();
        this.logger = configureLogging(extensionContext);
    }

    async waitForWorkspaceContext(): Promise<WorkspaceContext> {
        if (!this.state) {
            throw new Error("The Swift extension has not been activated yet.");
        }
        if (this.state.type === "failed") {
            throw this.state.error;
        }
        if (this.state.type === "active") {
            return this.state.context;
        }
        return await this.state.promise;
    }

    async withWorkspaceContext<T>(task: (ctx: WorkspaceContext) => T | Promise<T>): Promise<T> {
        const workspaceContext = await this.waitForWorkspaceContext();
        return await task(workspaceContext);
    }

    activate(callSite?: Error): void {
        if (this.state) {
            throw new Error("The Swift extension has already been activated.", {
                cause: this.state.activatedBy,
            });
        }

        try {
            this.logger.info(
                `Activating Swift for Visual Studio Code ${this.extensionContext.extension.packageJSON.version}...`
            );

            checkAndWarnAboutWindowsSymlinks(this.logger);
            checkForSwiftlyInstallation(this.contextKeys, this.logger);

            this.extensionContext.subscriptions.push(
                new SwiftEnvironmentVariablesManager(this.extensionContext),
                SwiftTerminalProfileProvider.register(),
                ...registerCommands(this),
                registerDebugger(this),
                new SelectedXcodeWatcher(this.logger),
                getReadOnlyDocumentProvider()
            );

            const activatedBy = callSite ?? Error("The extension was activated by:");
            activatedBy.name = "Activation Source";
            const tokenSource = new vscode.CancellationTokenSource();
            this.state = {
                type: "initializing",
                activatedBy,
                cancellation: new vscode.CancellationTokenSource(),
                promise: this.initializeWorkspace(tokenSource.token).then(
                    ({ context, subscriptions }) => {
                        this.state = { type: "active", activatedBy, context, subscriptions };
                        return context;
                    },
                    error => {
                        if (!tokenSource.token.isCancellationRequested) {
                            this.state = { type: "failed", activatedBy, error };
                        }
                        throw error;
                    }
                ),
            };

            // Mark the extension as activated.
            this.contextKeys.isActivated = true;
        } catch (error) {
            const errorMessage = getErrorDescription(error);
            // show this error message as the VS Code error message only shows when running
            // the extension through the debugger
            void vscode.window.showErrorMessage(
                `Activating Swift extension failed: ${errorMessage}`
            );
            throw error;
        }
    }

    private async initializeWorkspace(
        token: vscode.CancellationToken
    ): Promise<{ context: WorkspaceContext; subscriptions: vscode.Disposable[] }> {
        const globalToolchain = await createActiveToolchain(
            this.extensionContext,
            this.contextKeys,
            this.logger
        );
        const workspaceContext = new WorkspaceContext(
            this.extensionContext,
            this.contextKeys,
            this.logger,
            globalToolchain
        );
        await workspaceContext.addWorkspaceFolders();
        // project panel provider
        const dependenciesView = vscode.window.createTreeView("projectPanel", {
            treeDataProvider: workspaceContext.projectPanel,
            showCollapseAll: true,
        });
        workspaceContext.projectPanel.observeFolders(dependenciesView);

        if (token.isCancellationRequested) {
            throw new Error("WorkspaceContext initialization was cancelled.");
        }
        return {
            context: workspaceContext,
            subscriptions: [
                vscode.tasks.registerTaskProvider("swift", workspaceContext.taskProvider),
                vscode.tasks.registerTaskProvider("swift-plugin", workspaceContext.pluginProvider),
                new LanguageStatusItems(workspaceContext),
                workspaceContext.onDidChangeFolders(({ folder, operation }) => {
                    this.logger.info(`${operation}: ${folder?.folder.fsPath}`, folder?.name);
                }),
                dependenciesView,
                workspaceContext.onDidChangeFolders(handleFolderEvent(this.logger)),
                TestExplorer.observeFolders(workspaceContext),
                registerSourceKitSchemaWatcher(workspaceContext),
            ],
        };
    }

    deactivate(): void {
        this.contextKeys.isActivated = false;
        if (this.state?.type === "initializing") {
            this.state.cancellation.cancel();
        }
        if (this.state?.type === "active") {
            this.state.context.dispose();
            this.state.subscriptions.forEach(s => s.dispose());
        }
        this.extensionContext.subscriptions.forEach(subscription => subscription.dispose());
        this.extensionContext.subscriptions.length = 0;
        this.state = undefined;
    }

    dispose(): void {
        this.logger.dispose();
    }
}

function configureLogging(context: vscode.ExtensionContext) {
    const logger = new SwiftLoggerFactory(context.logUri).create(
        "Swift",
        "swift-vscode-extension.log"
    );
    // Create log directory asynchronously but don't await it to avoid blocking activation
    void vscode.workspace.fs
        .createDirectory(context.logUri)
        .then(undefined, error => logger.warn(`Failed to create log directory: ${error}`));
    return logger;
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
                void makeDebugConfigurations(folder);
                if (await folder.swiftPackage.foundPackage) {
                    // do not await for this, let packages resolve in parallel
                    void folderAdded(folder, workspace);
                }
                break;

            case FolderOperation.packageUpdated:
                // Create launch.json files based on package description.
                await makeDebugConfigurations(folder);
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
    extension: vscode.ExtensionContext,
    contextKeys: ContextKeys,
    logger: SwiftLogger
): Promise<SwiftToolchain> {
    try {
        const toolchain = await SwiftToolchain.create(extension.extensionPath, undefined, logger);
        toolchain.logDiagnostics(logger);
        contextKeys.updateKeysBasedOnActiveVersion(toolchain.swiftVersion);
        return toolchain;
    } catch (error) {
        if (!(await showToolchainError())) {
            throw error;
        }
        return await createActiveToolchain(extension, contextKeys, logger);
    }
}
