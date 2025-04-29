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
import { FolderContext } from "../FolderContext";

/**
 * Restart the sourcekit-lsp server. If multiple sourcekit-lsp instances
 * are running, the user will be prompted to select which one to restart.
 * If only one instance is running, it will be restarted automatically.
 * If no instances are running, this command will do nothing.
 * @param ctx The workspace context
 */
export default async function restartLSPServer(ctx: WorkspaceContext) {
    let toolchains = toolchainQuickPickItems(ctx);
    if (toolchains.length === 0) {
        return undefined;
    } else if (toolchains.length === 1) {
        // Skip picking a toolchain if there is only one option to pick
        return restartLSP(ctx, toolchains[0].label);
    } else {
        toolchains = [
            ...toolchains,
            {
                label: "All",
                description: "Restart all sourcekit-lsp instances",
                detail: toolchains.map(tc => tc.detail).join(", "),
            },
        ];
    }

    const selected = await vscode.window.showQuickPick(toolchains, {
        title: "Restart LSP server",
        placeHolder: "Select a sourcekit-lsp instance to restart",
        canPickMany: false,
    });

    if (!selected) {
        return undefined;
    }

    if (selected.label === "All") {
        const originalToolchains = toolchains.slice(0, -1);
        for (const toolchain of originalToolchains) {
            return restartLSP(ctx, toolchain.label);
        }
    } else {
        return restartLSP(ctx, selected.label);
    }
}

/**
 * Create a list of toolchain quick pick items from the workspace context
 * @param ctx The workspace context
 * @returns An array of quick pick items for each toolchain
 */
function toolchainQuickPickItems(ctx: WorkspaceContext): vscode.QuickPickItem[] {
    const toolchainLookup = ctx.folders.reduce(
        (acc, folder) => {
            acc[folder.swiftVersion.toString()] = acc[folder.swiftVersion.toString()] ?? [];
            acc[folder.swiftVersion.toString()].push({
                folder,
                fullToolchainName: folder.toolchain.swiftVersionString,
            });
            return acc;
        },
        {} as Record<string, { folder: FolderContext; fullToolchainName: string }[]>
    );

    return Object.keys(toolchainLookup).map(key => ({
        label: key,
        description: toolchainLookup[key][0].fullToolchainName,
        detail: toolchainLookup[key].map(({ folder }) => folder.name).join(", "),
    }));
}

/**
 * Restart the LSP server for a specific toolchain version
 * @param ctx The workspace context
 * @param version The toolchain version to restart
 */
async function restartLSP(ctx: WorkspaceContext, version: string) {
    const languageClientManager = ctx.languageClientManager.getByVersion(version);
    await languageClientManager.restart();
}
