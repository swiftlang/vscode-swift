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
import * as path from "path";
import * as vscode from "vscode";

import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { Swiftly } from "../toolchain/swiftly";
import { Workbench } from "../utilities/commands";
import { installSwiftlyToolchainWithProgressAndErrorMsgs } from "./installSwiftlyToolchain";

/**
 * Prompts user for Swiftly installation with directory customization options
 * @param logger Optional logger
 * @returns A promise that resolves to true if the user has opted to install swiftly, false otherwise
 */
export async function promptForSwiftlyInstallation(logger?: SwiftLogger): Promise<boolean> {
    const installMessage = `A .swift-version file was detected. Install Swiftly to automatically manage Swift toolchain versions for this project.`;

    const selection = await vscode.window.showWarningMessage(
        installMessage,
        { modal: false },
        "Install Swiftly",
        "Don't Show Again"
    );

    if (selection === "Install Swiftly") {
        const confirmation = await vscode.window.showInformationMessage(
            "Install Swiftly - The Swift Toolchain Version Manager",
            {
                modal: true,
                detail: `The Swift extension is going to install the swiftly toolchain manager on your behalf.

This process involves updating your shell profile in order to add swiftly to your PATH. Alternatively, you can also install swiftly yourself using the instructions at swift.org to customize the installation options.`,
            },
            "Continue",
            "Open Swiftly Documentation"
        );

        if (confirmation === "Continue") {
            return true;
        }

        if (confirmation === "Open Swiftly Documentation") {
            void vscode.env.openExternal(
                vscode.Uri.parse(
                    "https://www.swift.org/swiftly/documentation/swiftly/getting-started"
                )
            );
        }

        return false;
    }

    if (selection === "Don't Show Again") {
        await vscode.workspace
            .getConfiguration("swift")
            .update("disableSwiftlyInstallPrompt", true, vscode.ConfigurationTarget.Global);
        logger?.info("Swiftly installation prompt suppressed by user");
    }

    return false;
}

/**
 * Installs Swiftly with progress tracking and user feedback
 * @param options Installation options
 * @param logger Optional logger
 * @returns Promise<boolean> true if installation succeeded
 */
export async function installSwiftlyWithProgress(logger?: SwiftLogger): Promise<boolean> {
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Installing Swiftly",
                cancellable: false,
            },
            async progress => {
                await Swiftly.installSwiftly(progress, logger);
            }
        );
        return true;
    } catch (error) {
        logger?.error(`Failed to install Swiftly: ${error}`);
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to install Swiftly: ${message}`);
        return false;
    }
}

async function promptToRestartVSCode(): Promise<void> {
    const editorName = vscode.env.appName;
    const selection = await vscode.window.showInformationMessage(
        `Restart ${editorName}`,
        {
            modal: true,
            detail: `You must restart ${editorName} in order for the Swiftly installation to take effect. \n\nWhen you reopen ${editorName}, you will be prompted to install the Swift toolchain now that you have Swiftly installed.`,
        },
        `Quit ${editorName}`
    );
    if (selection === `Quit ${editorName}`) {
        await vscode.commands.executeCommand(Workbench.ACTION_QUIT);
    }
}

// TODO: rename function
/**
 * Main function to handle missing Swiftly detection and installation
 * @param swiftVersionFiles A list of swift version files that will need to be installed
 * @param logger Optional logger
 * @returns Promise<boolean> true if Swiftly was installed or already exists
 */
export async function handleMissingSwiftly(
    swiftVersions: string[],
    extensionRoot: string,
    logger?: SwiftLogger,
    skipPrompt: boolean = false
): Promise<boolean> {
    const isInstalled = await Swiftly.isInstalled();
    if (!isInstalled) {
        if (configuration.folder(undefined).disableSwiftlyInstallPrompt) {
            logger?.debug("Swiftly installation prompt is suppressed");
            return false;
        }

        if (!skipPrompt) {
            // Prompt user for installation
            if (!(await promptForSwiftlyInstallation(logger))) {
                return false;
            }
        }

        // Install Swiftly
        if (!(await installSwiftlyWithProgress(logger))) {
            return false;
        }

        await promptToRestartVSCode();
        return true;
    } else {
        // TODO: prompt user to install the toolchain
        // Install toolchains
        const swiftlyPath = path.join(Swiftly.defaultHomeDir(), "bin/swiftly");
        for (const version of swiftVersions) {
            const result = await installSwiftlyToolchainWithProgressAndErrorMsgs(
                version,
                extensionRoot,
                logger,
                swiftlyPath
            );

            if (!result.success) {
                if (result.errorMsg) {
                    await vscode.window.showErrorMessage("Installation failed", {
                        modal: true,
                        detail: result.errorMsg,
                    });
                }
                return false;
            }
        }

        return true;
    }
}
