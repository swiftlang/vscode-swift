//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { WorkspaceContext } from "../WorkspaceContext";
import { selectFolder } from "../ui/SelectFolderQuickPick";
import { folderExists, provisionDoccCatalog } from "../utilities/filesystem";

type TargetPickItem = vscode.QuickPickItem & {
    basePath: string;
    targetName: string;
};

async function findAvailableTargets(folder: FolderContext): Promise<TargetPickItem[]> {
    const items: TargetPickItem[] = [];
    const rootPath = folder.folder.fsPath;
    if (!folder.swiftPackage) {
        return items;
    }
    const targets = await folder.swiftPackage.getTargets();
    for (const target of targets) {
        const base = path.join(rootPath, target.path);
        if (await folderExists(base)) {
            items.push({
                label: target.name,
                description: target.type,
                detail: target.path,
                basePath: base,
                targetName: target.name,
            });
        }
    }
    if (items.length === 0) {
        void vscode.window.showErrorMessage(
            "No Swift package targets found. Open a folder that contains a Package.swift."
        );
    }
    return items;
}

/**
 * Walks the user through creating DocC documentation catalogs for one or more
 * SwiftPM targets. SourceKit-LSP discovers documentation via a .docc folder
 * within a target's sources.
 */
export async function createDocumentationCatalog(ctx: WorkspaceContext): Promise<void> {
    let folder: FolderContext | undefined;

    if (ctx.folders.length === 1) {
        folder = ctx.folders[0];
    } else if (ctx.folders.length === 0) {
        void vscode.window.showErrorMessage(
            "Creating a documentation catalog requires an open workspace folder."
        );
        return;
    } else {
        const selected = await selectFolder(
            ctx,
            "Select a workspace folder to create the DocC catalog in"
        );
        if (selected.length !== 1) {
            return;
        }
        folder = selected[0];
    }

    const selections = await vscode.window.showQuickPick(findAvailableTargets(folder), {
        title: "Create DocC Documentation Catalog",
        placeHolder: "Select one or more targets to add a documentation catalog to.",
        canPickMany: true,
    });

    if (!selections || selections.length === 0) {
        return;
    }

    const results = await Promise.all(
        selections.map(selection => provisionDoccCatalog(selection.basePath, selection.targetName))
    );

    const created: string[] = [];
    const skipped: string[] = [];
    selections.forEach((selection, index) => {
        if (results[index]) {
            created.push(`${selection.targetName}.docc`);
        } else {
            skipped.push(`${selection.targetName}.docc`);
        }
    });

    if (created.length > 0) {
        void vscode.window.showInformationMessage(`Created DocC catalog(s): ${created.join(", ")}`);
    }
    if (skipped.length > 0) {
        void vscode.window.showWarningMessage(
            `Catalog(s) already exist and were skipped: ${skipped.join(", ")}`
        );
    }
}
