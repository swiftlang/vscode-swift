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
import { FolderContext } from "../FolderContext";
import { WorkspaceContext } from "../WorkspaceContext";
import { makeDebugConfigurations } from "../debugger/launch";
import { selectFolder } from "../ui/SelectFolderQuickPick";

export async function generateLaunchConfigurations(ctx: WorkspaceContext): Promise<boolean> {
    if (ctx.folders.length === 0) {
        return false;
    }

    if (ctx.folders.length === 1) {
        return await makeDebugConfigurations(ctx.folders[0], { force: true, yes: true });
    }

    const foldersToUpdate: FolderContext[] = await selectFolder(
        ctx,
        "Select a folder to generate launch configurations for"
    );
    if (!foldersToUpdate.length) {
        return false;
    }

    return (
        await Promise.all(
            foldersToUpdate.map(folder =>
                makeDebugConfigurations(folder, { force: true, yes: true })
            )
        )
    ).reduceRight((prev, curr) => prev || curr);
}
