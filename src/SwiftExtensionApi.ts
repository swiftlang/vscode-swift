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
import configuration, { handleConfigurationChangeEvent } from "./configuration";
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
    | { type: "initializing"; promise: Promise<WorkspaceContext>; cancel(): void }
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
        const logSetupStartTime = Date.now();
        this.logger = configureLogging(this.extensionContext);
        const logSetupElapsed = Date.now() - logSetupStartTime;
        this.logger.info(`Log setup completed in ${logSetupElapsed}ms`);
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

        const activationStartTime = Date.now();
        try {
            this.logger.info(
                `Activating Swift for Visual Studio Code ${this.extensionContext.extension.packageJSON.version}...`
            );

            checkAndWarnAboutWindowsSymlinks(this.logger);
            checkForSwiftlyInstallation(this.contextKeys, this.logger);

            const subscriptionsStartTime = Date.now();
            this.extensionContext.subscriptions.push(
                new SwiftEnvironmentVariablesManager(this.extensionContext)
            );
            this.extensionContext.subscriptions.push(SwiftTerminalProfileProvider.register());

            this.extensionContext.subscriptions.push(...registerCommands(this));
            this.extensionContext.subscriptions.push(registerDebugger(this));
            this.extensionContext.subscriptions.push(new SelectedXcodeWatcher(this.logger));

            // swift module document provider
            this.extensionContext.subscriptions.push(getReadOnlyDocumentProvider());

            const subscriptionsElapsed = Date.now() - subscriptionsStartTime;

            const finalStepsStartTime = Date.now();
            const activatedBy = callSite ?? Error("Extension was activated by:");
            activatedBy.name = "ActivatedBy";
            const cancellationSource = new vscode.CancellationTokenSource();
            this.state = {
                type: "initializing",
                activatedBy,
                promise: this.initializeWorkspace(cancellationSource.token)
                    .then(({ workspaceContext, subscriptions }) => {
                        if (cancellationSource.token.isCancellationRequested) {
                            throw new vscode.CancellationError();
                        }

                        this.state = {
                            type: "active",
                            activatedBy,
                            context: workspaceContext,
                            subscriptions,
                        };
                        return workspaceContext;
                    })
                    .catch(error => {
                        if (!cancellationSource.token.isCancellationRequested) {
                            this.state = { type: "failed", activatedBy, error };
                        }
                        throw error;
                    }),
                cancel() {
                    cancellationSource.cancel();
                },
            };
            // Mark the extension as activated.
            this.contextKeys.isActivated = true;
            const finalStepsElapsed = Date.now() - finalStepsStartTime;

            const totalActivationTime = Date.now() - activationStartTime;
            this.logger.info(
                `Extension activation completed in ${totalActivationTime}ms (subscriptions: ${subscriptionsElapsed}ms, final-steps: ${finalStepsElapsed}ms)`
            );
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

    private async initializeWorkspace(token: vscode.CancellationToken): Promise<{
        workspaceContext: WorkspaceContext;
        subscriptions: vscode.Disposable[];
    }> {
        if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        const activationStartTime = Date.now();
        const toolchainStartTime = Date.now();
        const toolchain = await createActiveToolchain(
            this.extensionContext,
            this.contextKeys,
            this.logger
        );
        const toolchainElapsed = Date.now() - toolchainStartTime;

        if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        const workspaceContextStartTime = Date.now();
        const workspaceContext = new WorkspaceContext(
            this.extensionContext,
            this.contextKeys,
            this.logger,
            toolchain
        );
        this.extensionContext.subscriptions.push(workspaceContext);
        const workspaceContextElapsed = Date.now() - workspaceContextStartTime;

        const subscriptionsStartTime = Date.now();
        const subscriptions: vscode.Disposable[] = [];

        // Watch for configuration changes the trigger a reload of the extension if necessary.
        subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(
                handleConfigurationChangeEvent(workspaceContext)
            )
        );

        // Register task provider.
        subscriptions.push(
            vscode.tasks.registerTaskProvider("swift", workspaceContext.taskProvider)
        );

        // Register swift plugin task provider.
        subscriptions.push(
            vscode.tasks.registerTaskProvider("swift-plugin", workspaceContext.pluginProvider)
        );

        // Register the language status bar items.
        subscriptions.push(new LanguageStatusItems(workspaceContext));

        // project panel provider
        const dependenciesView = vscode.window.createTreeView("projectPanel", {
            treeDataProvider: workspaceContext.projectPanel,
            showCollapseAll: true,
        });
        workspaceContext.projectPanel.observeFolders(dependenciesView);
        subscriptions.push(dependenciesView);

        // observer that will resolve package and build launch configurations
        subscriptions.push(workspaceContext.onDidChangeFolders(handleFolderEvent(this.logger)));
        subscriptions.push(TestExplorer.observeFolders(workspaceContext));

        subscriptions.push(registerSourceKitSchemaWatcher(workspaceContext));

        // observer for logging workspace folder addition/removal
        subscriptions.push(
            workspaceContext.onDidChangeFolders(({ folder, operation }) => {
                this.logger.info(`${operation}: ${folder?.folder.fsPath}`, folder?.name);
            })
        );

        const subscriptionsElapsed = Date.now() - subscriptionsStartTime;

        // setup workspace context with initial workspace folders
        const workspaceFoldersStartTime = Date.now();
        await workspaceContext.addWorkspaceFolders();
        const workspaceFoldersElapsed = Date.now() - workspaceFoldersStartTime;

        if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        const totalActivationTime = Date.now() - activationStartTime;
        this.logger.info(
            `Workspace initialization completed in ${totalActivationTime}ms (toolchain: ${toolchainElapsed}ms, workspace-context: ${workspaceContextElapsed}ms, subscriptions: ${subscriptionsElapsed}ms, workspace-folders: ${workspaceFoldersElapsed}ms)`
        );

        return { workspaceContext, subscriptions };
    }

    deactivate(): void {
        this.contextKeys.isActivated = false;
        if (this.state?.type === "initializing") {
            this.state.cancel();
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
