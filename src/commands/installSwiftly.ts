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

/**
 * Handles the "Swiftly is not installed" case: installs Swiftly itself, prompting the
 * user first unless suppressed or skipped, then asks the user to restart the editor so
 * the installation can take effect.
 * @param options.logger Optional logger
 * @param options.skipPrompt Skips the confirmation prompt when the user has already opted
 *   in elsewhere (e.g. by clicking an explicit "Install Swiftly" button)
 * @returns Promise<boolean> true if Swiftly was installed
 */
export async function installSwiftly(options: {
    logger?: SwiftLogger;
    skipPrompt?: boolean;
}): Promise<boolean> {
    const { logger, skipPrompt = false } = options;
    if (configuration.folder(undefined).disableSwiftlyInstallPrompt) {
        logger?.debug("Swiftly installation prompt is suppressed");
        return false;
    }

    if (!skipPrompt && !(await promptForSwiftlyInstallation(logger))) {
        return false;
    }

    if (!(await installSwiftlyWithProgress(logger))) {
        return false;
    }

    await promptToRestartVSCode();
    return true;
}

/**
 * Handles the "Swiftly is installed but a required toolchain is missing" case: installs
 * the requested Swift toolchain versions using the already installed Swiftly, surfacing a
 * modal error if a version fails to install (for example, because it does not exist).
 * @param options.swiftVersions The Swift toolchain versions to install
 * @param options.extensionRoot The absolute path to the extension's installation directory
 * @param options.logger Optional logger
 * @returns Promise<boolean> true if every toolchain installed successfully
 */
export async function installMissingToolchains(options: {
    swiftVersions: string[];
    extensionRoot: string;
    logger?: SwiftLogger;
}): Promise<boolean> {
    const { swiftVersions, extensionRoot, logger } = options;
    const swiftlyPath = path.join(Swiftly.defaultHomeDir(), "bin/swiftly");
    for (const version of swiftVersions) {
        const result = await installSwiftlyToolchainWithProgressAndErrorMsgs(
            version,
            extensionRoot,
            logger,
            swiftlyPath
        );

        if (result.success) {
            continue;
        }

        if (result.errorMsg) {
            await vscode.window.showErrorMessage("Installation failed", {
                modal: true,
                detail: result.errorMsg,
            });
        }
        return false;
    }

    return true;
}

/**
 * Resolves which Swift toolchain version to install via Swiftly. Asks Swiftly directly for the
 * version it is configured to use (e.g. from a folder's .swift-version file), which it reports
 * whether or not that toolchain is installed. Falls back to the latest stable toolchain when
 * Swiftly does not report a specific version. Errors reading the version are propagated so they
 * surface to the user rather than silently installing the wrong toolchain.
 * @param folder Optional folder used to resolve a folder-specific (.swift-version) toolchain
 * @returns The version(s) to install; never empty
 */
export async function resolveSwiftVersionsToInstall(folder?: vscode.Uri): Promise<string[]> {
    const swiftlyPath = path.join(Swiftly.defaultHomeDir(), "bin/swiftly");
    const version = await Swiftly.inUseVersion(swiftlyPath, undefined, folder);
    if (version) {
        return [version];
    }
    return ["latest"];
}
