//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { InternalSwiftExtensionApi } from "../InternalSwiftExtensionApi";
import configuration from "../configuration";
import { SwiftToolchain } from "../toolchain/toolchain";
import { fileExists } from "../utilities/filesystem";
import { getErrorDescription, swiftRuntimeEnv } from "../utilities/utilities";
import { DebugAdapter, LaunchConfigType, SWIFT_LAUNCH_CONFIG_TYPE } from "./debugAdapter";
import { getTargetBinaryPath, swiftPrelaunchBuildTaskArguments } from "./launch";
import { getLLDBLibPath, updateLaunchConfigForCI } from "./lldb";
import { registerLoggingDebugAdapterTracker } from "./logTracker";

/**
 * Registers the active debugger with the extension, and reregisters it
 * when the debugger settings change.
 * @param api  The Swift extension API
 * @returns A disposable to be disposed when the extension is deactivated
 */
export function registerDebugger(api: InternalSwiftExtensionApi): vscode.Disposable {
    let subscriptions: vscode.Disposable[] = [];

    // Monitor the swift.debugger.disable setting and register automatically
    // when the setting is changed to enable.
    const configurationEvent = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("swift.debugger.disable")) {
            subscriptions.forEach(sub => sub.dispose());
            subscriptions = [];
            if (!configuration.debugger.disable) {
                register();
            }
        }
    });

    function register() {
        subscriptions.push(registerLoggingDebugAdapterTracker());
        subscriptions.push(registerLLDBDebugAdapter(api));
    }

    if (!configuration.debugger.disable) {
        register();
    }

    return vscode.Disposable.from(configurationEvent, ...subscriptions);
}

/**
 * Registers the LLDB debug adapter with the VS Code debug adapter descriptor factory.
 * @param api The Swift extension API
 * @returns A disposable to be disposed when the extension is deactivated
 */
function registerLLDBDebugAdapter(api: InternalSwiftExtensionApi): vscode.Disposable {
    return vscode.debug.registerDebugConfigurationProvider(
        SWIFT_LAUNCH_CONFIG_TYPE,
        new LLDBDebugConfigurationProvider(process.platform, api)
    );
}

/** Provide configurations for lldb-vscode/lldb-dap
 *
 * Converts launch configuration that user supplies into a version that the lldb-vscode/lldb-dap
 * debug adapter will use. Primarily it converts the environment variables from Object
 * to an array of strings in format "var=value".
 *
 * This could also be used to augment the configuration with values from the settings
 * although it isn't at the moment.
 */
export class LLDBDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(
        private platform: NodeJS.Platform,
        private api: InternalSwiftExtensionApi
    ) {}

    async resolveDebugConfigurationWithSubstitutedVariables(
        folder: vscode.WorkspaceFolder | undefined,
        launchConfig: vscode.DebugConfiguration
    ): Promise<vscode.DebugConfiguration | undefined | null> {
        // First attempt to find a folder context that matches the provided "folder".
        const workspaceContext = await this.api.waitForWorkspaceContext();
        let folderContext = workspaceContext.folders.find(
            f => f.workspaceFolder.uri.fsPath === folder?.uri.fsPath
        );

        // If we can't find it we're likely in a multi-root workspace and we should
        // attempt to find a folder context that matches the "cwd" in the launch configuration.
        if (!folderContext && launchConfig.cwd) {
            folderContext = workspaceContext.folders.find(
                f =>
                    path.normalize(f.workspaceFolder.uri.fsPath) ===
                    path.normalize(launchConfig.cwd)
            );
        }

        this.validateLaunchRequest(launchConfig);

        await this.resolveTargetToProgram(launchConfig, folderContext);

        this.fixWindowsProgramPath(launchConfig);

        const pidResult = await this.resolvePidProperty(launchConfig);
        if (pidResult !== true) {
            return pidResult;
        }

        this.mergeRuntimeEnvironment(launchConfig);

        const toolchain = folderContext?.toolchain ?? workspaceContext.globalToolchain;
        launchConfig.type = DebugAdapter.getLaunchConfigType(toolchain.swiftVersion);

        const adapterResult = await this.configureDebugAdapter(launchConfig, toolchain);
        if (adapterResult !== true) {
            return adapterResult;
        }

        return updateLaunchConfigForCI(launchConfig);
    }

    private validateLaunchRequest(launchConfig: vscode.DebugConfiguration): void {
        if (
            launchConfig.request === "launch" &&
            !("program" in launchConfig) &&
            !("target" in launchConfig)
        ) {
            throw new Error(
                "You must specify either a 'program' or a 'target' when 'request' is set to 'launch' in a Swift debug configuration. Please update your debug configuration."
            );
        }
    }

    private async resolveTargetToProgram(
        launchConfig: vscode.DebugConfiguration,
        folderContext: FolderContext | undefined
    ): Promise<void> {
        if (typeof launchConfig.target !== "string") {
            return;
        }

        if ("program" in launchConfig) {
            throw new Error(
                `Unable to set both "target" and "program" on the same Swift debug configuration. Please remove one of them from your debug configuration.`
            );
        }

        const targetName = launchConfig.target;
        if (!folderContext) {
            throw new Error(
                `Unable to resolve target "${targetName}". No Swift package is available to search within.`
            );
        }

        const buildConfiguration = launchConfig.configuration ?? "debug";
        if (!["debug", "release"].includes(buildConfiguration)) {
            throw new Error(
                `Unknown configuration property "${buildConfiguration}" in Swift debug configuration. Valid options are "debug" or "release. Please update your debug configuration.`
            );
        }

        launchConfig.program = await getTargetBinaryPath(
            targetName,
            buildConfiguration,
            folderContext,
            await swiftPrelaunchBuildTaskArguments(launchConfig, folderContext.workspaceFolder)
        );
        delete launchConfig.target;
    }

    private fixWindowsProgramPath(launchConfig: vscode.DebugConfiguration): void {
        if (this.platform !== "win32") {
            return;
        }
        if (launchConfig.testType !== undefined) {
            return;
        }
        const ext = path.extname(launchConfig.program);
        if (ext === ".exe" || ext === ".xctest") {
            return;
        }
        launchConfig.program += ".exe";
    }

    private async resolvePidProperty(
        launchConfig: vscode.DebugConfiguration
    ): Promise<true | undefined | null> {
        if (!("pid" in launchConfig)) {
            return true;
        }

        const pid = Number.parseInt(launchConfig.pid, 10);
        if (!isNaN(pid)) {
            launchConfig.pid = pid;
            return true;
        }

        return vscode.window
            .showErrorMessage(
                "Failed to launch debug session",
                {
                    modal: true,
                    detail: `Invalid process ID: "${launchConfig.pid}" is not a valid integer. Please update your launch configuration`,
                },
                "Configure"
            )
            .then(userSelection => {
                if (userSelection === "Configure") {
                    return null;
                }
                return undefined;
            });
    }

    private mergeRuntimeEnvironment(launchConfig: vscode.DebugConfiguration): void {
        const runtimeEnv = swiftRuntimeEnv(true);
        if (!runtimeEnv) {
            return;
        }
        const existingEnv = launchConfig.env ?? {};
        launchConfig.env = { ...runtimeEnv, existingEnv };
    }

    private async configureDebugAdapter(
        launchConfig: vscode.DebugConfiguration,
        toolchain: SwiftToolchain
    ): Promise<true | undefined> {
        if (launchConfig.type === LaunchConfigType.CODE_LLDB) {
            return this.configureCodeLLDB(launchConfig, toolchain);
        }

        if (launchConfig.type === LaunchConfigType.LLDB_DAP) {
            return this.configureLLDBDap(launchConfig, toolchain);
        }

        return true;
    }

    private async configureCodeLLDB(
        launchConfig: vscode.DebugConfiguration,
        toolchain: SwiftToolchain
    ): Promise<true | undefined> {
        launchConfig.sourceLanguages = ["swift"];

        if (!vscode.extensions.getExtension("vadimcn.vscode-lldb")) {
            if (!(await this.promptToInstallCodeLLDB())) {
                return undefined;
            }
        }

        await this.promptForCodeLldbSettingsIfRequired(toolchain);

        if ("terminateCommands" in launchConfig) {
            launchConfig["preTerminateCommands"] = launchConfig["terminateCommands"];
            delete launchConfig["terminateCommands"];
        }

        return true;
    }

    private async configureLLDBDap(
        launchConfig: vscode.DebugConfiguration,
        toolchain: SwiftToolchain
    ): Promise<true | undefined> {
        if (launchConfig.env) {
            launchConfig.env = this.convertEnvironmentVariables(launchConfig.env);
        }

        const lldbDapPath = await DebugAdapter.getLLDBDebugAdapterPath(toolchain);
        if (!(await fileExists(lldbDapPath))) {
            void vscode.window.showErrorMessage(
                `Cannot find the LLDB debug adapter in your Swift toolchain: No such file or directory "${lldbDapPath}"`
            );
            return undefined;
        }

        launchConfig.debugAdapterExecutable = lldbDapPath;
        return true;
    }

    private async promptToInstallCodeLLDB(): Promise<boolean> {
        const selection = await vscode.window.showErrorMessage(
            "The CodeLLDB extension is required to debug with Swift toolchains prior to Swift 6.0. Please install the extension to continue.",
            { modal: true },
            "Install CodeLLDB",
            "View Extension"
        );
        switch (selection) {
            case "Install CodeLLDB":
                await vscode.commands.executeCommand(
                    "workbench.extensions.installExtension",
                    "vadimcn.vscode-lldb"
                );
                return true;
            case "View Extension":
                await vscode.commands.executeCommand(
                    "workbench.extensions.search",
                    "@id:vadimcn.vscode-lldb"
                );
                await vscode.commands.executeCommand(
                    "workbench.extensions.action.showReleasedVersion",
                    "vadimcn.vscode-lldb"
                );
                return false;
            case undefined:
                return false;
        }
    }

    async promptForCodeLldbSettingsIfRequired(toolchain: SwiftToolchain) {
        const libLldbPathResult = await getLLDBLibPath(toolchain);
        if (!libLldbPathResult.success) {
            const errorMessage = `Error: ${getErrorDescription(libLldbPathResult.failure)}`;
            void vscode.window.showWarningMessage(
                `Failed to setup CodeLLDB for debugging of Swift code. Debugging may produce unexpected results. ${errorMessage}`
            );
            this.api.logger.error(`Failed to setup CodeLLDB: ${errorMessage}`);
            return;
        }
        const libLldbPath = libLldbPathResult.success;
        const lldbConfig = vscode.workspace.getConfiguration("lldb");
        if (
            lldbConfig.get<string>("library") === libLldbPath &&
            lldbConfig.get<string>("launch.expressions") === "native"
        ) {
            return;
        }
        let userSelection: "Global" | "Workspace" | "Run Anyway" | undefined = undefined;
        switch (configuration.debugger.setupCodeLLDB) {
            case "prompt":
                userSelection = await vscode.window.showInformationMessage(
                    "The Swift extension needs to update some CodeLLDB settings to enable debugging features. Do you want to set this up in your global settings or workspace settings?",
                    { modal: true },
                    "Global",
                    "Workspace",
                    "Run Anyway"
                );
                break;
            case "alwaysUpdateGlobal":
                userSelection = "Global";
                break;
            case "alwaysUpdateWorkspace":
                userSelection = "Workspace";
                break;
            case "never":
                userSelection = "Run Anyway";
                break;
        }
        switch (userSelection) {
            case "Global":
                await lldbConfig.update("library", libLldbPath, vscode.ConfigurationTarget.Global);
                await lldbConfig.update(
                    "launch.expressions",
                    "native",
                    vscode.ConfigurationTarget.Global
                );
                // clear workspace setting
                await lldbConfig.update("library", undefined, vscode.ConfigurationTarget.Workspace);
                // clear workspace setting
                await lldbConfig.update(
                    "launch.expressions",
                    undefined,
                    vscode.ConfigurationTarget.Workspace
                );
                break;
            case "Workspace":
                await lldbConfig.update(
                    "library",
                    libLldbPath,
                    vscode.ConfigurationTarget.Workspace
                );
                await lldbConfig.update(
                    "launch.expressions",
                    "native",
                    vscode.ConfigurationTarget.Workspace
                );
                break;
        }
    }

    private convertEnvironmentVariables(map: { [key: string]: string }): string[] {
        return Object.entries(map).map(([key, value]) => `${key}=${value}`);
    }
}
