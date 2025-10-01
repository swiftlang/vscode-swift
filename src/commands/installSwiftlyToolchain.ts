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
import { QuickPickItem } from "vscode";

import { WorkspaceContext } from "../WorkspaceContext";
import { SwiftLogger } from "../logging/SwiftLogger";
import { AvailableToolchain, Swiftly, SwiftlyProgressData } from "../toolchain/swiftly";
import { showReloadExtensionNotification } from "../ui/ReloadExtension";

interface SwiftlyToolchainItem extends QuickPickItem {
    toolchain: AvailableToolchain;
}

async function downloadAndInstallToolchain(selected: SwiftlyToolchainItem, ctx: WorkspaceContext) {
    return await installSwiftlyToolchainVersion(selected.toolchain.version.name, ctx.logger, true);
}

/**
 * Installs a Swiftly toolchain by version string
 * @param version The toolchain version to install
 * @param logger Optional logger for error reporting
 * @param showReloadNotification Whether to show reload notification after installation
 * @returns Promise<boolean> true if installation succeeded, false otherwise
 */
export async function installSwiftlyToolchainVersion(
    version: string,
    logger?: SwiftLogger,
    showReloadNotification: boolean = true,
    token?: vscode.CancellationToken
): Promise<boolean> {
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Installing Swift ${version}`,
                cancellable: true,
            },
            async (progress, progressToken) => {
                const effectiveToken = token || progressToken;
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
                    effectiveToken
                );

                progress.report({
                    increment: 100 - lastProgress,
                    message: "Installation complete",
                });
            }
        );

        if (showReloadNotification) {
            void showReloadExtensionNotification(
                `Swift ${version} has been installed and activated. Visual Studio Code needs to be reloaded.`
            );
        }
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
export async function installSwiftlyToolchain(ctx: WorkspaceContext): Promise<void> {
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

    const availableToolchains = await Swiftly.listAvailable(undefined, ctx.logger);

    if (availableToolchains.length === 0) {
        ctx.logger?.debug("No toolchains available for installation via Swiftly.");
        void vscode.window.showInformationMessage(
            "No toolchains are available for installation via Swiftly."
        );
        return;
    }

    const uninstalledToolchains = availableToolchains.filter(toolchain => !toolchain.installed);

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

    await downloadAndInstallToolchain(selected, ctx);
}

/**
 * Shows a quick pick dialog to install available Swiftly snapshot toolchains
 */
export async function installSwiftlySnapshotToolchain(ctx: WorkspaceContext): Promise<void> {
    if (!Swiftly.isSupported()) {
        void vscode.window.showErrorMessage(
            "Swiftly is not supported on this platform. Only macOS and Linux are supported."
        );
        return;
    }

    if (!(await Swiftly.isInstalled())) {
        void vscode.window.showErrorMessage(
            "Swiftly is not installed. Please install Swiftly first from https://www.swift.org/install/"
        );
        return;
    }

    // Prompt user to enter the branch for snapshot toolchains
    const branch = await vscode.window.showInputBox({
        title: "Enter Swift Snapshot Branch",
        prompt: "Enter the branch name to list snapshot toolchains (e.g., 'main-snapshot', '6.1-snapshot')",
        placeHolder: "main-snapshot",
        value: "main-snapshot",
    });

    if (!branch) {
        return; // User cancelled input
    }

    const availableToolchains = await Swiftly.listAvailable(branch, ctx.logger);

    if (availableToolchains.length === 0) {
        ctx.logger?.debug("No toolchains available for installation via Swiftly.");
        void vscode.window.showInformationMessage(
            "No toolchains are available for installation via Swiftly."
        );
        return;
    }

    // Filter for only uninstalled snapshot toolchains
    const uninstalledSnapshotToolchains = availableToolchains.filter(
        toolchain => !toolchain.installed && toolchain.version.type === "snapshot"
    );

    if (uninstalledSnapshotToolchains.length === 0) {
        ctx.logger?.debug("All available snapshot toolchains are already installed.");
        void vscode.window.showInformationMessage(
            "All available snapshot toolchains are already installed."
        );
        return;
    }

    const quickPickItems = uninstalledSnapshotToolchains.map(toolchain => ({
        label: `$(cloud-download) ${toolchain.version.name}`,
        description: "snapshot",
        detail: `Date: ${
            toolchain.version.type === "snapshot" ? toolchain.version.date || "Unknown" : "Unknown"
        } • Branch: ${toolchain.version.type === "snapshot" ? toolchain.version.branch || "Unknown" : "Unknown"}`,
        toolchain: toolchain,
    }));

    const selected = await vscode.window.showQuickPick(quickPickItems, {
        title: "Install Swift Snapshot Toolchain via Swiftly",
        placeHolder: "Pick a Swift snapshot toolchain to install",
        canPickMany: false,
    });

    if (!selected) {
        return;
    }

    await downloadAndInstallToolchain(selected, ctx);
}
