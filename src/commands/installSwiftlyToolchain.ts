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
import {
    AvailableToolchain,
    SwiftlyProgressData,
    isSnapshotVersion,
    isStableVersion,
} from "../swiftly/types";
import { showReloadExtensionNotification } from "../ui/ReloadExtension";
import { Result } from "../utilities/result";

async function downloadAndInstallToolchain(toolchain: string, ctx: WorkspaceContext) {
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Installing Swift ${toolchain}`,
                cancellable: false,
            },
            async progress => {
                progress.report({ message: "Starting installation..." });

                let lastProgress = 0;

                await ctx.swiftly.installToolchain(
                    toolchain,
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
                    }
                );

                progress.report({
                    increment: 100 - lastProgress,
                    message: "Installation complete",
                });
            }
        );
        void showReloadExtensionNotification(
            `Swift ${toolchain} has been installed and activated. Visual Studio Code needs to be reloaded.`
        );
    } catch (error) {
        ctx.logger.error(`Failed to install Swift ${toolchain}: ${error}`);
        void vscode.window.showErrorMessage(`Failed to install Swift ${toolchain}: ${error}`);
    }
}

/**
 * Shows a quick pick dialog to install available Swiftly toolchains
 */
export async function installSwiftlyToolchain(ctx: WorkspaceContext): Promise<void> {
    if (!ctx.swiftly.isSupported()) {
        ctx.logger.warn("Swiftly is not supported on this platform.");
        void vscode.window.showErrorMessage(
            "Swiftly is not supported on this platform. Only macOS and Linux are supported."
        );
        return;
    }

    const availableToolchains = (await ctx.swiftly.getAvailableToolchains())
        .flatMapError(() => Result.success([]))
        .getOrThrow();

    if (availableToolchains.length === 0) {
        ctx.logger.debug("No toolchains available for installation via ctx.swiftly.");
        void vscode.window.showInformationMessage(
            "No toolchains are available for installation via ctx.swiftly."
        );
        return;
    }

    const uninstalledToolchains = availableToolchains.filter(toolchain => !toolchain.installed);

    if (uninstalledToolchains.length === 0) {
        ctx.logger.debug("All available toolchains are already installed.");
        void vscode.window.showInformationMessage(
            "All available toolchains are already installed."
        );
        return;
    }

    // Sort toolchains with most recent versions first and filter only stable releases
    const sortedToolchains = sortToolchainsByVersion(
        uninstalledToolchains.filter(toolchain => toolchain.version.type === "stable")
    );

    ctx.logger.debug(
        `Available toolchains for installation: ${sortedToolchains.map(t => t.version.name).join(", ")}`
    );
    const quickPickItems = sortedToolchains.map(toolchain => ({
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

    await downloadAndInstallToolchain(selected.toolchain.version.name, ctx);
}

/**
 * Shows a quick pick dialog to install available Swiftly snapshot toolchains
 */
export async function installSwiftlySnapshotToolchain(ctx: WorkspaceContext): Promise<void> {
    if (!ctx.swiftly.isSupported()) {
        void vscode.window.showErrorMessage(
            "Swiftly is not supported on this platform. Only macOS and Linux are supported."
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

    const availableToolchains = (await ctx.swiftly.getAvailableToolchains(branch))
        .flatMapError(() => Result.success([]))
        .getOrThrow();

    if (availableToolchains.length === 0) {
        ctx.logger.debug("No toolchains available for installation via ctx.swiftly.");
        void vscode.window.showInformationMessage(
            "No toolchains are available for installation via ctx.swiftly."
        );
        return;
    }

    // Filter for only uninstalled snapshot toolchains
    const uninstalledSnapshotToolchains = availableToolchains.filter(
        toolchain => !toolchain.installed && toolchain.version.type === "snapshot"
    );

    if (uninstalledSnapshotToolchains.length === 0) {
        ctx.logger.debug("All available snapshot toolchains are already installed.");
        void vscode.window.showInformationMessage(
            "All available snapshot toolchains are already installed."
        );
        return;
    }

    // Sort toolchains with most recent versions first
    const sortedToolchains = sortToolchainsByVersion(uninstalledSnapshotToolchains);

    const quickPickItems = sortedToolchains.map(toolchain => ({
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

    await downloadAndInstallToolchain(selected.toolchain.version.name, ctx);
}

/**
 * Sorts toolchains by version in descending order.
 */
function sortToolchainsByVersion(toolchains: AvailableToolchain[]): AvailableToolchain[] {
    return toolchains.sort((a, b) => {
        // First sort by type (stable before snapshot)
        if (a.version.type !== b.version.type) {
            return isStableVersion(a.version) ? -1 : 1;
        }

        // For stable releases, sort by semantic version
        if (isStableVersion(a.version) && isStableVersion(b.version)) {
            const versionA = a.version;
            const versionB = b.version;

            if (versionA && versionB) {
                if (versionA.major !== versionB.major) {
                    return versionB.major - versionA.major;
                }
                if (versionA.minor !== versionB.minor) {
                    return versionB.minor - versionA.minor;
                }
                return versionB.patch - versionA.patch;
            }
        }

        // For snapshots, sort by date (newer first)
        if (isSnapshotVersion(a.version) && isSnapshotVersion(b.version)) {
            const dateA = a.version.date;
            const dateB = b.version.date;

            if (dateA && dateB) {
                return dateB.localeCompare(dateA);
            }
        }

        // Fallback to string comparison
        return b.version.name.localeCompare(a.version.name);
    });
}
