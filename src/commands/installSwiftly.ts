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
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { SwiftLogger } from "../logging/SwiftLogger";
import { Swiftly } from "../toolchain/swiftly";

interface SwiftlyInstallOptions {
    swiftlyHomeDir?: string;
    swiftlyBinDir?: string;
}

/**
 * Prompts user for Swiftly installation with directory customization options
 * @param logger Optional logger
 * @returns Promise<SwiftlyInstallOptions | null> Installation options if user wants to install, null otherwise
 */
export async function promptForSwiftlyInstallation(
    logger?: SwiftLogger
): Promise<SwiftlyInstallOptions | null> {
    const installMessage = `A .swift-version file was detected. Install Swiftly to automatically manage Swift toolchain versions for this project.`;

    const selection = await vscode.window.showInformationMessage(
        installMessage,
        { modal: false },
        "Install Swiftly",
        "Customize Directories",
        "Don't Show Again",
        "Cancel"
    );

    switch (selection) {
        case "Install Swiftly":
            return {}; // Use defaults

        case "Customize Directories":
            return await promptForDirectoryCustomization(logger);

        case "Don't Show Again":
            // Set a workspace setting to suppress this prompt
            await vscode.workspace
                .getConfiguration("swift")
                .update("suppressSwiftlyInstallPrompt", true, vscode.ConfigurationTarget.Global);
            logger?.info("Swiftly installation prompt suppressed by user");
            return null;

        case "Cancel":
        default:
            return null;
    }
}

/**
 * Prompts user to customize Swiftly installation directories
 * @param logger Optional logger
 * @returns Promise<SwiftlyInstallOptions | null>
 */
async function promptForDirectoryCustomization(
    logger?: SwiftLogger
): Promise<SwiftlyInstallOptions | null> {
    const homeDir = os.homedir();
    const defaultSwiftlyHome = path.join(homeDir, ".swiftly");
    const defaultSwiftlyBin = path.join(homeDir, ".local", "bin");

    const customHomeDir = await vscode.window.showInputBox({
        title: "Customize Swiftly Home Directory",
        prompt: "Enter the directory where Swiftly will store its data and toolchains",
        value: defaultSwiftlyHome,
        placeHolder: defaultSwiftlyHome,
        validateInput: value => {
            if (!value || value.trim().length === 0) {
                return "Directory path cannot be empty";
            }
            if (!path.isAbsolute(value)) {
                return "Please provide an absolute path";
            }
            return null;
        },
    });

    if (customHomeDir === undefined) {
        return null; // User cancelled
    }

    const customBinDir = await vscode.window.showInputBox({
        title: "Customize Swiftly Binary Directory",
        prompt: "Enter the directory where Swiftly binaries will be installed",
        value: defaultSwiftlyBin,
        placeHolder: defaultSwiftlyBin,
        validateInput: value => {
            if (!value || value.trim().length === 0) {
                return "Directory path cannot be empty";
            }
            if (!path.isAbsolute(value)) {
                return "Please provide an absolute path";
            }
            return null;
        },
    });

    if (customBinDir === undefined) {
        return null; // User cancelled
    }

    logger?.info(`User customized Swiftly directories: home=${customHomeDir}, bin=${customBinDir}`);

    return {
        swiftlyHomeDir: customHomeDir.trim(),
        swiftlyBinDir: customBinDir.trim(),
    };
}

/**
 * Installs Swiftly with progress tracking and user feedback
 * @param options Installation options
 * @param logger Optional logger
 * @returns Promise<boolean> true if installation succeeded
 */
export async function installSwiftlyWithProgress(
    options: SwiftlyInstallOptions,
    logger?: SwiftLogger
): Promise<boolean> {
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Installing Swiftly",
                cancellable: false,
            },
            async progress => {
                await Swiftly.installSwiftly(
                    progress,
                    logger,
                    options.swiftlyHomeDir,
                    options.swiftlyBinDir
                );
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

/**
 * Checks if the Swiftly installation prompt should be suppressed
 * @returns true if suppressed, false otherwise
 */
export function isSwiftlyPromptSuppressed(): boolean {
    return vscode.workspace.getConfiguration("swift").get("suppressSwiftlyInstallPrompt", false);
}

/**
 * Main function to handle missing Swiftly detection and installation
 * @param logger Optional logger
 * @returns Promise<boolean> true if Swiftly was installed or already exists
 */
export async function handleMissingSwiftly(logger?: SwiftLogger): Promise<boolean> {
    // Check if Swiftly is missing
    if (await Swiftly.isInstalled()) {
        return true; // Swiftly is already installed
    }

    // Check if prompt is suppressed
    if (isSwiftlyPromptSuppressed()) {
        logger?.debug("Swiftly installation prompt is suppressed");
        return false;
    }

    // Prompt user for installation
    const options = await promptForSwiftlyInstallation(logger);
    if (!options) {
        return false; // User cancelled or suppressed
    }

    // Install Swiftly
    const installSuccess = await installSwiftlyWithProgress(options, logger);

    return installSuccess;
}
