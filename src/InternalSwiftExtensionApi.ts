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
import * as fs from "fs/promises";
import * as vscode from "vscode";

import { ContextKeyManager, ContextKeys } from "./ContextKeyManager";
import { FolderContext } from "./FolderContext";
import { SwiftExtensionApi } from "./SwiftExtensionApi";
import { TestExplorer } from "./TestExplorer/TestExplorer";
import { FolderEvent, FolderOperation, WorkspaceContext } from "./WorkspaceContext";
import { registerCommands } from "./commands";
import { resolveFolderDependencies } from "./commands/dependencies/resolve";
import { registerSourceKitSchemaWatcher } from "./commands/generateSourcekitConfiguration";
import { handleMissingSwiftly } from "./commands/installSwiftly";
import configuration, {
    ConfigurationValidationError,
    handleConfigurationChangeEvent,
} from "./configuration";
import { registerDebugger } from "./debugger/debugAdapterFactory";
import { makeDebugConfigurations } from "./debugger/launch";
import { SwiftLogger } from "./logging/SwiftLogger";
import { SwiftLoggerFactory } from "./logging/SwiftLoggerFactory";
import { PlaygroundProvider } from "./playgrounds/PlaygroundProvider";
import { SwiftEnvironmentVariablesManager, SwiftTerminalProfileProvider } from "./terminal";
import { SelectedXcodeWatcher } from "./toolchain/SelectedXcodeWatcher";
import { Swiftly } from "./toolchain/swiftly";
import { SwiftToolchain } from "./toolchain/toolchain";
import { LanguageStatusItems } from "./ui/LanguageStatusItems";
import { getReadOnlyDocumentProvider } from "./ui/ReadOnlyDocumentProvider";
import { showToolchainError } from "./ui/ToolchainSelection";
import { checkAndWarnAboutWindowsSymlinks } from "./ui/win32";
import { globDirectory } from "./utilities/filesystem";
import { getErrorDescription } from "./utilities/utilities";
import { Version } from "./utilities/version";

type UninitializedState = {
    type: "uninitialized";
};

type InitializingState = {
    type: "initializing";
    promise: Promise<WorkspaceContext>;
    cancel(): void;
    activatedBy: Error;
};

type ActiveState = {
    type: "active";
    context: WorkspaceContext;
    subscriptions: vscode.Disposable[];
    activatedBy: Error;
};

type FailedState = {
    type: "failed";
    error: unknown;
    activatedBy: Error;
};

type State = UninitializedState | InitializingState | ActiveState | FailedState;

export class InternalSwiftExtensionApi implements SwiftExtensionApi {
    private state: State = { type: "uninitialized" };

    get workspaceContext(): WorkspaceContext | undefined {
        if (this.state?.type !== "active") {
            return undefined;
        }
        return this.state.context;
    }

    contextKeys: ContextKeys;

    logger: SwiftLogger;

    constructor(
        public readonly version: Version,
        private readonly extensionContext: vscode.ExtensionContext
    ) {
        this.contextKeys = new ContextKeyManager();
        const logSetupStartTime = Date.now();
        this.logger = configureLogging(this.extensionContext);
        const logSetupElapsed = Date.now() - logSetupStartTime;
        this.logger.info(`Log setup completed in ${logSetupElapsed}ms`);
    }

    async waitForWorkspaceContext(): Promise<WorkspaceContext> {
        if (this.state.type === "uninitialized") {
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

    // This method is synchronous on purpose. All asynchronous loading should be done within initializeWorkspace()
    // to avoid delaying extension activation.
    activate(callSite?: Error): void {
        if (this.state.type !== "uninitialized") {
            throw new Error("The Swift extension has already been activated.", {
                cause: this.state.activatedBy,
            });
        }

        const activatedBy = callSite ?? Error("Extension was activated by:");
        activatedBy.name = "ActivatedBy";

        const activationStartTime = Date.now();
        try {
            this.logger.info(
                `Activating Swift for Visual Studio Code ${this.extensionContext.extension.packageJSON.version}...`
            );

            checkAndWarnAboutWindowsSymlinks(this.logger);
            void checkForSwiftlyInstallation(
                this.extensionContext.extensionPath,
                this.contextKeys,
                this.logger
            );

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
            this.state = { type: "failed", error, activatedBy };
            // Handle configuration validation errors with UI that points the user to the poorly configured setting
            if (error instanceof ConfigurationValidationError) {
                return; // User is notified by code in configuration.ts
            }
            const errorMessage = getErrorDescription(error);
            // show this error message as the VS Code error message only shows when running
            // the extension through the debugger
            void vscode.window.showErrorMessage(
                `Activating Swift extension failed: ${errorMessage}`
            );
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
            this.extensionContext.extensionPath,
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
        subscriptions.push(PlaygroundProvider.observeFolders(workspaceContext));

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
        this.state = { type: "uninitialized" };
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

/**
 * Checks whether or not Swiftly is installed and updates context keys appropriately.
 */
export async function checkForSwiftlyInstallation(
    extensionPath: string,
    contextKeys: ContextKeys,
    logger: SwiftLogger
): Promise<void> {
    contextKeys.supportsSwiftlyInstall = false;
    if (!Swiftly.isSupported()) {
        logger.debug(`Swiftly is not available on ${process.platform}`);
        return Promise.resolve();
    }

    // Don't block extension activation waiting for Swiftly checks
    const isSwiftlyInstalled = await Swiftly.isInstalled();
    try {
        if (!isSwiftlyInstalled) {
            logger.debug("Swiftly is not installed on this system.");
            await checkAndPromptToInstallSwiftly(extensionPath, logger);
            return;
        }
        const version = await Swiftly.version(logger);
        if (!version) {
            logger.warn("Unable to determine Swiftly version.");
            return;
        }
        logger.debug(`Detected Swiftly version ${version}.`);
        contextKeys.supportsSwiftlyInstall = version.isGreaterThanOrEqual({
            major: 1,
            minor: 1,
            patch: 0,
        });
    } catch (error) {
        logger.error(Error("Failed to verify Swiftly installation.", { cause: error }));
    }
}

/**
 * Checks for .swift-version file(s) in the workspace. If any are found then the user will be prompted to install Swiftly.
 */
async function checkAndPromptToInstallSwiftly(
    extensionRoot: string,
    logger: SwiftLogger
): Promise<void> {
    // Bail early if the user has disabled the swiftly install prompt, or is ignoring .swift-version files, globally
    if (
        configuration.folder(undefined).disableSwiftlyInstallPrompt ||
        configuration.folder(undefined).ignoreSwiftVersionFile
    ) {
        logger?.debug("Swiftly installation prompt is suppressed");
        return;
    }
    // Check to see if there are any .swift-version files in the workspace
    const swiftVersionFiles = await findSwiftVersionFilesInWorkspace();
    const allSwiftVersionsWithUndefined = await Promise.all(
        swiftVersionFiles.map(async file => {
            // Validate that the configuration for the folder containing the
            // .swift-version file does not disable the swiftly install prompt or ignore swiftly
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));
            if (
                workspaceFolder &&
                (configuration.folder(workspaceFolder).disableSwiftlyInstallPrompt ||
                    configuration.folder(workspaceFolder).ignoreSwiftVersionFile)
            ) {
                logger?.debug("Swiftly installation prompt is suppressed");
                return undefined;
            }
            return (await fs.readFile(file, "utf-8")).trim();
        })
    );
    const allSwiftVersions: string[] = allSwiftVersionsWithUndefined.filter(
        (v): v is string => v !== undefined && v.length > 0
    );
    const uniqueSwiftVersions = [...new Set(allSwiftVersions)];
    if (uniqueSwiftVersions.length === 0) {
        return;
    }
    logger.debug(`Detected swift version file(s): ${uniqueSwiftVersions.join(", ")}`);
    logger.debug("Prompting user to install Swiftly.");
    await handleMissingSwiftly(uniqueSwiftVersions, extensionRoot, logger);
}

/**
 * Checks if any workspace folder contains a .swift-version file
 */
function findSwiftVersionFilesInWorkspace(): Promise<string[]> {
    return Promise.all(
        (vscode.workspace.workspaceFolders ?? []).map(folder => {
            return globDirectory(folder.uri, "**/.swift-version", {
                absolute: true,
                onlyFiles: true,
            });
        })
    ).then(results => results.reduceRight((prev, curr) => prev.concat(curr), []));
}

function handleFolderEvent(logger: SwiftLogger): (event: FolderEvent) => Promise<void> {
    // function called when a folder is added. I broke this out so we can trigger it
    // without having to await for it.
    async function folderAdded(folder: FolderContext, workspace: WorkspaceContext) {
        const disableAutoResolve = configuration.folder(folder.workspaceFolder).disableAutoResolve;
        const backgroundCompilationEnabled = configuration.backgroundCompilation.enabled;
        if (!disableAutoResolve || backgroundCompilationEnabled) {
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
                        workspace.contextKeys.updateForPlugins(workspace.folders);
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
                // Create launch.json files based on package description, don't block execution.
                void makeDebugConfigurations(folder);

                // Do not await for this, let packages resolve in parallel
                void folder.swiftPackage.foundPackage.then(async foundPackage => {
                    if (foundPackage) {
                        await folderAdded(folder, workspace);
                    }
                });
                break;

            case FolderOperation.packageUpdated:
                // Create launch.json files based on package description, don't block execution.
                void makeDebugConfigurations(folder);

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
    extensionPath: string,
    contextKeys: ContextKeys,
    logger: SwiftLogger
): Promise<SwiftToolchain> {
    try {
        const toolchain = await SwiftToolchain.create(extensionPath, logger);
        toolchain.logDiagnostics(logger);
        contextKeys.updateKeysBasedOnActiveVersion(toolchain.swiftVersion);
        return toolchain;
    } catch (error) {
        if (!(await showToolchainError())) {
            throw error;
        }
        return await createActiveToolchain(extensionPath, contextKeys, logger);
    }
}
