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

import * as fs from "fs/promises";
import * as vscode from "vscode";

import { ContextKeyManager, ContextKeys } from "./ContextKeyManager";
import { FolderContext } from "./FolderContext";
import { SwiftExtensionApi } from "./SwiftExtensionApi";
import { TestExplorer } from "./TestExplorer/TestExplorer";
import { FolderEvent, FolderOperation, WorkspaceContext } from "./WorkspaceContext";
import * as commands from "./commands";
import { resolveFolderDependencies } from "./commands/dependencies/resolve";
import { registerSourceKitSchemaWatcher } from "./commands/generateSourcekitConfiguration";
import { handleMissingSwiftly } from "./commands/installSwiftly";
import configuration, {
    ConfigurationValidationError,
    handleConfigurationChangeEvent,
    openSettingsJsonForSetting,
} from "./configuration";
import { registerDebugger } from "./debugger/debugAdapterFactory";
import * as debug from "./debugger/launch";
import { SwiftLogger } from "./logging/SwiftLogger";
import { SwiftLoggerFactory } from "./logging/SwiftLoggerFactory";
import { PlaygroundProvider } from "./playgrounds/PlaygroundProvider";
import { SwiftEnvironmentVariablesManager, SwiftTerminalProfileProvider } from "./terminal";
import { SelectedXcodeWatcher } from "./toolchain/SelectedXcodeWatcher";
import { Swiftly, checkForSwiftlyInstallation } from "./toolchain/swiftly";
import { SwiftToolchain } from "./toolchain/toolchain";
import { LanguageStatusItems } from "./ui/LanguageStatusItems";
import { getReadOnlyDocumentProvider } from "./ui/ReadOnlyDocumentProvider";
import { showToolchainError } from "./ui/ToolchainSelection";
import { checkAndWarnAboutWindowsSymlinks } from "./ui/win32";
import { getErrorDescription } from "./utilities/utilities";
import { Version } from "./utilities/version";

export interface InternalSwiftExtensionApi extends SwiftExtensionApi {
    workspaceContext?: WorkspaceContext;
    logger: SwiftLogger;
    activate(): Promise<InternalSwiftExtensionApi>;
    deactivate(): Promise<void>;
}

/**
 * Activate the extension. This is the main entry point.
 */
export async function activate(
    context: vscode.ExtensionContext
): Promise<InternalSwiftExtensionApi> {
    const activationStartTime = Date.now();
    try {
        const logSetupStartTime = Date.now();
        const logger = configureLogging(context);
        const logSetupElapsed = Date.now() - logSetupStartTime;
        logger.info(
            `Activating Swift for Visual Studio Code ${context.extension.packageJSON.version}...`
        );
        logger.info(`Log setup completed in ${logSetupElapsed}ms`);

        const preToolchainStartTime = Date.now();
        checkAndWarnAboutWindowsSymlinks(logger);

        const contextKeys = new ContextKeyManager();
        const preToolchainElapsed = Date.now() - preToolchainStartTime;
        const toolchainStartTime = Date.now();
        const toolchain = await createActiveToolchain(context, contextKeys, logger);
        const toolchainElapsed = Date.now() - toolchainStartTime;

        const swiftlyCheckStartTime = Date.now();
        checkForSwiftlyInstallation(contextKeys, logger);
        const swiftlyCheckElapsed = Date.now() - swiftlyCheckStartTime;

        // If we don't have a toolchain, show an error and stop initializing the extension.
        // This can happen if the user has not installed Swift or if the toolchain is not
        // properly configured.
        if (!toolchain) {
            // In order to select a toolchain we need to register the command first.
            const subscriptions = commands.registerToolchainCommands(undefined, logger);
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

        const workspaceContextStartTime = Date.now();
        const workspaceContext = new WorkspaceContext(context, contextKeys, logger, toolchain);
        context.subscriptions.push(workspaceContext);
        const workspaceContextElapsed = Date.now() - workspaceContextStartTime;

        const subscriptionsStartTime = Date.now();
        context.subscriptions.push(new SwiftEnvironmentVariablesManager(context));
        context.subscriptions.push(SwiftTerminalProfileProvider.register());
        context.subscriptions.push(
            ...commands.registerToolchainCommands(workspaceContext, workspaceContext.logger)
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
        context.subscriptions.push(PlaygroundProvider.observeFolders(workspaceContext));

        context.subscriptions.push(registerSourceKitSchemaWatcher(workspaceContext));
        const subscriptionsElapsed = Date.now() - subscriptionsStartTime;

        // setup workspace context with initial workspace folders
        const workspaceFoldersStartTime = Date.now();
        await workspaceContext.addWorkspaceFolders();
        const workspaceFoldersElapsed = Date.now() - workspaceFoldersStartTime;

        const finalStepsStartTime = Date.now();
        const apiVersion = await getApiVersionNumber(context);
        // Mark the extension as activated.
        contextKeys.isActivated = true;
        const finalStepsElapsed = Date.now() - finalStepsStartTime;

        const totalActivationTime = Date.now() - activationStartTime;
        logger.info(
            `Extension activation completed in ${totalActivationTime}ms (log-setup: ${logSetupElapsed}ms, pre-toolchain: ${preToolchainElapsed}ms, toolchain: ${toolchainElapsed}ms, swiftly-check: ${swiftlyCheckElapsed}ms, workspace-context: ${workspaceContextElapsed}ms, subscriptions: ${subscriptionsElapsed}ms, workspace-folders: ${workspaceFoldersElapsed}ms, final-steps: ${finalStepsElapsed}ms)`
        );

        return {
            workspaceContext,
            logger,
            version: apiVersion,
            activate: () => activate(context),
            deactivate: async () => {
                await workspaceContext.stop();
                await deactivate(context);
            },
        };
    } catch (error) {
        // Handle configuration validation errors with UI that points the user to the poorly configured setting
        if (error instanceof ConfigurationValidationError) {
            void vscode.window.showErrorMessage(error.message, "Open Settings").then(selection => {
                if (selection === "Open Settings") {
                    void openSettingsJsonForSetting(error.settingName);
                }
            });
        } else {
            const errorMessage = getErrorDescription(error);
            // show this error message as the VS Code error message only shows when running
            // the extension through the debugger
            void vscode.window.showErrorMessage(
                `Activating Swift extension failed: ${errorMessage}`
            );
        }
        throw error;
    }
}

function configureLogging(context: vscode.ExtensionContext) {
    // Create log directory asynchronously but don't await it to avoid blocking activation
    const logDirPromise = vscode.workspace.fs.createDirectory(context.logUri);

    const logger = new SwiftLoggerFactory(context.logUri).create(
        "Swift",
        "swift-vscode-extension.log"
    );
    context.subscriptions.push(logger);

    void Promise.resolve(logDirPromise)
        .then(() => {
            // File transport will be added when directory is ready
        })
        .catch((error: unknown) => {
            logger.warn(`Failed to create log directory: ${error}`);
        });
    return logger;
}

async function getApiVersionNumber(context: vscode.ExtensionContext): Promise<Version> {
    try {
        const packageJsonPath = context.asAbsolutePath("package.json");
        const packageJsonRaw = await fs.readFile(packageJsonPath, "utf-8");
        const packageJson = JSON.parse(packageJsonRaw);
        const apiVersionRaw = packageJson["api-version"];
        if (!apiVersionRaw || typeof apiVersionRaw !== "string") {
            throw Error(
                `The "api-version" property in the package.json is missing or invalid: ${JSON.stringify(apiVersionRaw)}`
            );
        }
        const apiVersion = Version.fromString(apiVersionRaw);
        if (!apiVersion) {
            throw Error(
                `Unable to parse the "api-version" string from the package.json: "${apiVersionRaw}"`
            );
        }
        return apiVersion;
    } catch (error) {
        throw Error("Failed to load the Swift extension API version number from the package.json", {
            cause: error,
        });
    }
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
                void debug.makeDebugConfigurations(folder);

                if (await folder.swiftPackage.foundPackage) {
                    // do not await for this, let packages resolve in parallel
                    void folderAdded(folder, workspace);
                }
                break;

            case FolderOperation.packageUpdated:
                // Create launch.json files based on package description, don't block execution.
                void debug.makeDebugConfigurations(folder);

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

/**
 * Checks if any workspace folder contains a .swift-version file
 */
async function hasSwiftVersionFile(): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return false;
    }

    for (const folder of workspaceFolders) {
        try {
            const swiftVersionPath = vscode.Uri.joinPath(folder.uri, ".swift-version");
            await vscode.workspace.fs.stat(swiftVersionPath);
            return true;
        } catch {
            // File doesn't exist, continue checking other folders
        }
    }

    return false;
}

async function createActiveToolchain(
    extension: vscode.ExtensionContext,
    contextKeys: ContextKeys,
    logger: SwiftLogger
): Promise<SwiftToolchain | undefined> {
    // Check if there's a .swift-version file in the workspace and Swiftly is not installed
    if (await hasSwiftVersionFile()) {
        const swiftlyInstalled = await Swiftly.isInstalled();

        if (!swiftlyInstalled) {
            logger.info(
                "Detected .swift-version file in workspace without Swiftly, prompting for Swiftly installation"
            );
            const installed = await handleMissingSwiftly(logger);
            if (installed) {
                // Try to create the toolchain again after Swiftly installation
                try {
                    const toolchain = await SwiftToolchain.create(
                        extension.extensionPath,
                        undefined,
                        logger
                    );
                    toolchain.logDiagnostics(logger);
                    contextKeys.updateKeysBasedOnActiveVersion(toolchain.swiftVersion);
                    return toolchain;
                } catch (retryError) {
                    logger.error(
                        `Failed to create toolchain after Swiftly installation: ${retryError}`
                    );
                }
            }
        }
    }

    try {
        const toolchain = await SwiftToolchain.create(extension.extensionPath, undefined, logger);
        toolchain.logDiagnostics(logger);
        contextKeys.updateKeysBasedOnActiveVersion(toolchain.swiftVersion);
        return toolchain;
    } catch (error) {
        logger.error(`Failed to discover Swift toolchain: ${error}`);
        return undefined;
    }
}

async function deactivate(context: vscode.ExtensionContext): Promise<void> {
    const api: InternalSwiftExtensionApi = context.extension.exports;
    const workspaceContext = api.workspaceContext;
    if (workspaceContext) {
        workspaceContext.contextKeys.isActivated = false;
    }
    context.subscriptions.forEach(subscription => subscription.dispose());
    context.subscriptions.length = 0;
}
