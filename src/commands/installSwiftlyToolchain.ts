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
import { Swiftly, AvailableToolchain, SwiftlyProgressData } from "../toolchain/swiftly";
import { showReloadExtensionNotification } from "../ui/ReloadExtension";

/**
 * Shows a quick pick dialog to install available Swiftly toolchains
 */
export async function installSwiftlyToolchain(ctx: WorkspaceContext): Promise<void> {
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

    const uninstalledToolchains = availableToolchains.filter(toolchain => !toolchain.isInstalled);

    if (uninstalledToolchains.length === 0) {
        void vscode.window.showInformationMessage(
            "All available toolchains are already installed."
        );
        return;
    }

    // Sort toolchains with most recent versions first
    const sortedToolchains = sortToolchainsByVersion(uninstalledToolchains);

    const quickPickItems = sortedToolchains.map(toolchain => ({
        label: `$(cloud-download) ${toolchain.name}`,
        description: toolchain.type,
        detail: `Install ${toolchain.type} release`,
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

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Installing Swift ${selected.toolchain.name}`,
                cancellable: false,
            },
            async progress => {
                progress.report({ message: "Starting installation..." });

                let lastProgress = 0;

                await Swiftly.installToolchain(
                    selected.toolchain.name,
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
            `Swift ${selected.toolchain.name} has been installed and activated. Visual Studio Code needs to be reloaded.`
        );
    } catch (error) {
        ctx.logger?.error(`Failed to install Swift ${selected.toolchain.name}: ${error}`);
        void vscode.window.showErrorMessage(
            `Failed to install Swift ${selected.toolchain.name}: ${error}`
        );
    }
}

/**
 * Sorts toolchains by version with most recent first
 */
function sortToolchainsByVersion(toolchains: AvailableToolchain[]): AvailableToolchain[] {
    return toolchains.sort((a, b) => {
        // First sort by type (stable before snapshot)
        if (a.type !== b.type) {
            return a.type === "stable" ? -1 : 1;
        }

        // For stable releases, sort by semantic version
        if (a.type === "stable") {
            const versionA = parseStableVersion(a.name);
            const versionB = parseStableVersion(b.name);

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
        if (a.type === "snapshot") {
            const dateA = extractSnapshotDate(a.name);
            const dateB = extractSnapshotDate(b.name);

            if (dateA && dateB) {
                return dateB.localeCompare(dateA);
            }
        }

        // Fallback to string comparison
        return b.name.localeCompare(a.name);
    });
}

function parseStableVersion(
    version: string
): { major: number; minor: number; patch: number } | null {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (match) {
        return {
            major: parseInt(match[1], 10),
            minor: parseInt(match[2], 10),
            patch: parseInt(match[3], 10),
        };
    }
    return null;
}

function extractSnapshotDate(version: string): string | null {
    const match = version.match(/(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}
