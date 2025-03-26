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

import * as vscode from "vscode";
import * as path from "path";
import { WorkspaceContext } from "../WorkspaceContext";
import { DebugAdapter, LaunchConfigType, SWIFT_LAUNCH_CONFIG_TYPE } from "./debugAdapter";
import { registerLoggingDebugAdapterTracker } from "./logTracker";
import { SwiftToolchain } from "../toolchain/toolchain";
import { SwiftOutputChannel } from "../ui/SwiftOutputChannel";
import { fileExists } from "../utilities/filesystem";
import { getLLDBLibPath } from "./lldb";
import { getErrorDescription } from "../utilities/utilities";
import configuration from "../configuration";

/**
 * Registers the active debugger with the extension, and reregisters it
 * when the debugger settings change.
 * @param workspaceContext  The workspace context
 * @returns A disposable to be disposed when the extension is deactivated
 */
export function registerDebugger(workspaceContext: WorkspaceContext): vscode.Disposable {
    const subscriptions: vscode.Disposable[] = [
        registerLoggingDebugAdapterTracker(),
        registerLLDBDebugAdapter(workspaceContext.toolchain, workspaceContext.outputChannel),
    ];

    return {
        dispose: () => {
            subscriptions.map(sub => sub.dispose());
        },
    };
}

/**
 * Registers the LLDB debug adapter with the VS Code debug adapter descriptor factory.
 * @param workspaceContext The workspace context
 * @returns A disposable to be disposed when the extension is deactivated
 */
function registerLLDBDebugAdapter(
    toolchain: SwiftToolchain,
    outputChannel: SwiftOutputChannel
): vscode.Disposable {
    return vscode.debug.registerDebugConfigurationProvider(
        SWIFT_LAUNCH_CONFIG_TYPE,
        new LLDBDebugConfigurationProvider(process.platform, toolchain, outputChannel)
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
        private toolchain: SwiftToolchain,
        private outputChannel: SwiftOutputChannel
    ) {}

    async resolveDebugConfigurationWithSubstitutedVariables(
        _folder: vscode.WorkspaceFolder | undefined,
        launchConfig: vscode.DebugConfiguration
    ): Promise<vscode.DebugConfiguration | undefined | null> {
        // Fix the program path on Windows to include the ".exe" extension
        if (
            this.platform === "win32" &&
            launchConfig.testType === undefined &&
            path.extname(launchConfig.program) !== ".exe" &&
            path.extname(launchConfig.program) !== ".xctest"
        ) {
            launchConfig.program += ".exe";
        }

        // Convert "pid" property from a string to a number to make the process picker work.
        if ("pid" in launchConfig) {
            const pid = Number.parseInt(launchConfig.pid, 10);
            if (isNaN(pid)) {
                return await vscode.window
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
                            return null; // Opens the launch configuration when returned from a DebugConfigurationProvider
                        }
                        return undefined; // Only stops the debug session from starting
                    });
            }
            launchConfig.pid = pid;
        }

        // Delegate to the appropriate debug adapter extension
        launchConfig.type = DebugAdapter.getLaunchConfigType(this.toolchain.swiftVersion);
        if (launchConfig.type === LaunchConfigType.CODE_LLDB) {
            launchConfig.sourceLanguages = ["swift"];
            if (!vscode.extensions.getExtension("vadimcn.vscode-lldb")) {
                if (!(await this.promptToInstallCodeLLDB())) {
                    return undefined;
                }
            }
            if (!(await this.promptForCodeLldbSettings())) {
                return undefined;
            }
        } else if (launchConfig.type === LaunchConfigType.LLDB_DAP) {
            if (launchConfig.env) {
                launchConfig.env = this.convertEnvironmentVariables(launchConfig.env);
            }
            const lldbDapPath = await DebugAdapter.getLLDBDebugAdapterPath(this.toolchain);
            // Verify that the debug adapter exists or bail otherwise
            if (!(await fileExists(lldbDapPath))) {
                vscode.window.showErrorMessage(
                    `Cannot find the LLDB debug adapter in your Swift toolchain: No such file or directory "${lldbDapPath}"`
                );
                return undefined;
            }
            launchConfig.debugAdapterExecutable = lldbDapPath;
        }

        return launchConfig;
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

    private async promptForCodeLldbSettings(): Promise<boolean> {
        const libLldbPathResult = await getLLDBLibPath(this.toolchain);
        if (!libLldbPathResult.success) {
            const errorMessage = `Error: ${getErrorDescription(libLldbPathResult.failure)}`;
            vscode.window.showWarningMessage(
                `Failed to setup CodeLLDB for debugging of Swift code. Debugging may produce unexpected results. ${errorMessage}`
            );
            this.outputChannel.log(`Failed to setup CodeLLDB: ${errorMessage}`);
            return true;
        }
        const libLldbPath = libLldbPathResult.success;
        const lldbConfig = vscode.workspace.getConfiguration("lldb");
        if (
            lldbConfig.get<string>("library") === libLldbPath &&
            lldbConfig.get<string>("launch.expressions") === "native"
        ) {
            return true;
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
                lldbConfig.update("library", libLldbPath, vscode.ConfigurationTarget.Global);
                lldbConfig.update(
                    "launch.expressions",
                    "native",
                    vscode.ConfigurationTarget.Global
                );
                // clear workspace setting
                lldbConfig.update("library", undefined, vscode.ConfigurationTarget.Workspace);
                // clear workspace setting
                lldbConfig.update(
                    "launch.expressions",
                    undefined,
                    vscode.ConfigurationTarget.Workspace
                );
                break;
            case "Workspace":
                lldbConfig.update("library", libLldbPath, vscode.ConfigurationTarget.Workspace);
                lldbConfig.update(
                    "launch.expressions",
                    "native",
                    vscode.ConfigurationTarget.Workspace
                );
                break;
        }
        return true;
    }

    private convertEnvironmentVariables(map: { [key: string]: string }): string[] {
        return Object.entries(map).map(([key, value]) => `${key}=${value}`);
    }
}
