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

export default async function restartLSPServer(ctx: WorkspaceContext) {
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

    const toolchains: vscode.QuickPickItem[] = Object.keys(toolchainLookup).map(key => ({
        label: key,
        description: toolchainLookup[key][0].fullToolchainName,
        detail: toolchainLookup[key].map(({ folder }) => folder.name).join(", "),
    }));

    // Skip picking a toolchain if there is only one option to pick
    if (toolchains.length === 1) {
        return restartLSP(ctx, toolchains[0].label);
    }

    const selected = await vscode.window.showQuickPick(toolchains, {
        title: "Restart LSP server",
        placeHolder: "Select a sourcekit-lsp instance to restart",
        canPickMany: false,
    });

    if (!selected) {
        return undefined;
    }

    return restartLSP(ctx, selected.label);
}

async function restartLSP(ctx: WorkspaceContext, version: string) {
    const languageClientManager = ctx.languageClientManager.getByVersion(version);
    await languageClientManager.restart();
}
