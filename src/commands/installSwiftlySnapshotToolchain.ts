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
import { Swiftly, SwiftlyProgressData, ListAvailableResult } from "../toolchain/swiftly";
import { showReloadExtensionNotification } from "../ui/ReloadExtension";

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

    const availableToolchains = await Swiftly.listAvailable(ctx.logger);

    if (availableToolchains.length === 0) {
        void vscode.window.showInformationMessage(
            "No toolchains are available for installation via Swiftly."
        );
        return;
    }

    // Filter for only uninstalled snapshot toolchains
    const uninstalledSnapshotToolchains = availableToolchains.filter(
        toolchain => !toolchain.isInstalled && toolchain.version.type === "snapshot"
    );

    if (uninstalledSnapshotToolchains.length === 0) {
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
        detail: `Install snapshot version • Date: ${toolchain.version.type === "snapshot" ? toolchain.version.date || "Unknown" : "Unknown"} • Branch: ${toolchain.version.type === "snapshot" ? toolchain.version.branch || "Unknown" : "Unknown"}`,
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

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Installing Swift ${selected.toolchain.version.name}`,
                cancellable: false,
            },
            async progress => {
                progress.report({ message: "Starting installation..." });

                let lastProgress = 0;

                await Swiftly.installToolchain(
                    selected.toolchain.version.name,
                    (progressData: SwiftlyProgressData) => {
                        if (
                            progressData.step?.percent !== undefined &&
                            progressData.step.percent > lastProgress
                        ) {
                            const increment = progressData.step.percent - lastProgress;
                            progress.report({
                                increment,
                                message:
                                    progressData.step.text ||
                                    `${progressData.step.percent}% complete`,
                            });
                            lastProgress = progressData.step.percent;
                        }
                    },
                    ctx.logger
                );

                progress.report({
                    increment: 100 - lastProgress,
                    message: "Installation complete",
                });
            }
        );

        void showReloadExtensionNotification(
            `Swift ${selected.toolchain.version.name} has been installed and activated. Visual Studio Code needs to be reloaded.`
        );
    } catch (error) {
        ctx.logger?.error(`Failed to install Swift ${selected.toolchain.version.name}: ${error}`);
        void vscode.window.showErrorMessage(
            `Failed to install Swift ${selected.toolchain.version.name}: ${error}`
        );
    }
}

/**
 * Sorts snapshot toolchains by version with most recent first
 */
function sortToolchainsByVersion(
    toolchains: (ListAvailableResult["toolchains"][0] & { isInstalled: boolean })[]
): (ListAvailableResult["toolchains"][0] & { isInstalled: boolean })[] {
    return toolchains.sort((a, b) => {
        // For snapshots, sort by date (newer first)
        if (a.version.type === "snapshot" && b.version.type === "snapshot") {
            const dateA = extractSnapshotDate(a.version.name);
            const dateB = extractSnapshotDate(b.version.name);

            if (dateA && dateB) {
                return dateB.localeCompare(dateA);
            }
        }

        // Fallback to string comparison
        return b.version.name.localeCompare(a.version.name);
    });
}

function extractSnapshotDate(version: string): string | null {
    const match = version.match(/(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}
