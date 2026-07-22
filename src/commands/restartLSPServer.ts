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
import { SourceKitLanguageClient } from "../sourcekit-lsp/client/SourceKitLanguageClient";

/**
 * Restart the sourcekit-lsp server. If multiple sourcekit-lsp instances
 * are running, the user will be prompted to select which one to restart.
 * If only one instance is running, it will be restarted automatically.
 * If no instances are running, this command will do nothing.
 * @param ctx The workspace context
 */
export default async function restartLSPServer(ctx: WorkspaceContext): Promise<void> {
    const toolchains = toolchainQuickPickItems(ctx);
    if (toolchains.length === 0) {
        return;
    } else if (toolchains.length === 1) {
        // Skip picking a toolchain if there is only one option to pick
        return toolchains[0].client.restart();
    }

    const selected = await vscode.window.showQuickPick<
        RestartAllQuickPickItem | ToolchainQuickPickItem
    >(
        [
            {
                label: "All",
                description: "Restart all sourcekit-lsp instances",
                detail: toolchains.map(tc => tc.detail).join(", "),
                client: "restart-all",
            },
            ...toolchains,
        ],
        {
            title: "Restart LSP server",
            placeHolder: "Select a sourcekit-lsp instance to restart",
            canPickMany: false,
        }
    );

    if (!selected) {
        return undefined;
    }

    if (selected.client === "restart-all") {
        await Promise.all(toolchains.map(toolchain => toolchain.client.restart()));
        return;
    }
    return selected.client.restart();
}

interface RestartAllQuickPickItem extends vscode.QuickPickItem {
    client: "restart-all";
}

interface ToolchainQuickPickItem extends vscode.QuickPickItem {
    client: SourceKitLanguageClient;
}

/**
 * Create a list of toolchain quick pick items from the workspace context
 * @param ctx The workspace context
 * @returns An array of quick pick items for each toolchain
 */
function toolchainQuickPickItems(ctx: WorkspaceContext): ToolchainQuickPickItem[] {
    return ctx.languageClientManager
        .getAllClients()
        .reduce<ToolchainQuickPickItem[]>((acc, client) => {
            return [
                ...acc,
                {
                    client,
                    label: client.swiftVersion.toString(),
                    description: client.toolchain.swiftVersionString,
                    detail: client.addedFolders.map(folder => folder.name).join(", "),
                },
            ];
        }, []);
}
