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

import { WorkspaceContext } from "../WorkspaceContext";
import { SwiftLogger } from "../logging/SwiftLogger";
import { Swiftly, SwiftlyProgressData } from "../toolchain/swiftly";
import { askWhereToSetToolchain } from "../ui/ToolchainSelection";

/**
 * Installs a Swiftly toolchain and shows a progress notification to the user.
 *
 * @param version The toolchain version to install
 * @param logger Optional logger for error reporting
 * @returns Promise<boolean> true if installation succeeded, false otherwise
 */
export async function installSwiftlyToolchainWithProgress(
    version: string,
    logger?: SwiftLogger
): Promise<boolean> {
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Installing Swift ${version}`,
                cancellable: true,
            },
            async (progress, token) => {
                progress.report({ message: "Starting installation..." });

                let lastProgress = 0;

                await Swiftly.installToolchain(
                    version,
                    (progressData: SwiftlyProgressData) => {
                        if (
                            progressData.step?.percent !== undefined &&
                            progressData.step.percent > lastProgress
                        ) {
                            const increment = progressData.step.percent - lastProgress;
                            progress.report({
                                increment,
                                message:
                                    progressData.step.text ??
                                    `${progressData.step.percent}% complete`,
                            });
                            lastProgress = progressData.step.percent;
                        }
                    },
                    logger,
                    token
                );

                progress.report({
                    increment: 100 - lastProgress,
                    message: "Installation complete",
                });
            }
        );

        return true;
    } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes(Swiftly.cancellationMessage)) {
            logger?.info(`Installation of Swift ${version} was cancelled by user`);
            // Don't show error message for user-initiated cancellation
            return false;
        }

        logger?.error(`Failed to install Swift ${version}: ${error}`);
        void vscode.window.showErrorMessage(`Failed to install Swift ${version}: ${error}`);
        return false;
    }
}

/**
 * Shows a quick pick dialog to install available Swiftly toolchains
 */
export async function promptToInstallSwiftlyToolchain(
    ctx: WorkspaceContext,
    type: "stable" | "snapshot"
): Promise<void> {
    if (!Swiftly.isSupported()) {
        ctx.logger?.warn("Swiftly is not supported on this platform.");
        void vscode.window.showErrorMessage(
            "Swiftly is not supported on this platform. Only macOS and Linux are supported."
        );
        return;
    }

    if (!(await Swiftly.isInstalled())) {
        ctx.logger?.warn("Swiftly is not installed.");
        void vscode.window.showErrorMessage(
            "Swiftly is not installed. Please install Swiftly first from https://www.swift.org/install/"
        );
        return;
    }

    let branch: string | undefined = undefined;
    if (type === "snapshot") {
        // Prompt user to enter the branch for snapshot toolchains
        branch = await vscode.window.showInputBox({
            title: "Enter Swift Snapshot Branch",
            prompt: "Enter the branch name to list snapshot toolchains (e.g., 'main-snapshot', '6.1-snapshot')",
            placeHolder: "main-snapshot",
            value: "main-snapshot",
        });
        if (!branch) {
            return; // User cancelled input
        }
    }

    const availableToolchains = await Swiftly.listAvailable(branch, ctx.logger);

    if (availableToolchains.length === 0) {
        ctx.logger?.debug("No toolchains available for installation via Swiftly.");
        void vscode.window.showInformationMessage(
            "No toolchains are available for installation via Swiftly."
        );
        return;
    }

    const uninstalledToolchains = availableToolchains
        .filter(toolchain => !toolchain.installed)
        .filter(toolchain => toolchain.version.type === type);

    if (uninstalledToolchains.length === 0) {
        ctx.logger?.debug("All available toolchains are already installed.");
        void vscode.window.showInformationMessage(
            "All available toolchains are already installed."
        );
        return;
    }

    ctx.logger.debug(
        `Available toolchains for installation: ${uninstalledToolchains.map(t => t.version.name).join(", ")}`
    );
    const quickPickItems = uninstalledToolchains.map(toolchain => ({
        label: `$(cloud-download) ${toolchain.version.name}`,
        toolchain: toolchain,
    }));

    const selected = await vscode.window.showQuickPick(quickPickItems, {
        title: "Install Swift Toolchain via Swiftly",
        placeHolder: "Pick a Swift toolchain to install",
        canPickMany: false,
    });
    if (!selected) {
        return;
    }

    const target = await askWhereToSetToolchain();
    if (!target) {
        return;
    }

    // Install the toolchain via Swiftly
    if (!(await installSwiftlyToolchainWithProgress(selected.toolchain.version.name, ctx.logger))) {
        return;
    }
    // Tell Swiftly to use the newly installed toolchain
    if (target === vscode.ConfigurationTarget.Workspace) {
        await Promise.all(
            vscode.workspace.workspaceFolders?.map(folder =>
                Swiftly.use(selected.toolchain.version.name, folder.uri.fsPath)
            ) ?? []
        );
        return;
    }
    await Swiftly.use(selected.toolchain.version.name);
}
