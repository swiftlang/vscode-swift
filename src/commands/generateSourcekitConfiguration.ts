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

import { join } from "path";
import * as vscode from "vscode";
import { FolderContext } from "../FolderContext";
import { selectFolder } from "../ui/SelectFolderQuickPick";
import { WorkspaceContext } from "../WorkspaceContext";
import configuration from "../configuration";

export async function generateSourcekitConfiguration(ctx: WorkspaceContext): Promise<boolean> {
    if (ctx.folders.length === 0) {
        return false;
    }

    if (ctx.folders.length === 1) {
        const folder = ctx.folders[0];
        const success = await createSourcekitConfiguration(ctx, folder);
        void vscode.window.showTextDocument(vscode.Uri.file(sourcekitConfigFilePath(folder)));
        return success;
    }

    const foldersToGenerate: FolderContext[] = await selectFolder(
        ctx,
        "Select a folder to generate a SourceKit-LSP configuration for"
    );
    if (!foldersToGenerate.length) {
        return false;
    }

    return (
        await Promise.all(
            foldersToGenerate.map(folder => createSourcekitConfiguration(ctx, folder))
        )
    ).reduceRight((prev, curr) => prev || curr);
}

export const sourcekitFolderPath = (f: FolderContext) => join(f.folder.fsPath, ".sourcekit-lsp");
export const sourcekitConfigFilePath = (f: FolderContext) =>
    join(sourcekitFolderPath(f), "config.json");

async function createSourcekitConfiguration(
    workspaceContext: WorkspaceContext,
    folderContext: FolderContext
): Promise<boolean> {
    const sourcekitFolder = vscode.Uri.file(sourcekitFolderPath(folderContext));
    const sourcekitConfigFile = vscode.Uri.file(sourcekitConfigFilePath(folderContext));

    try {
        await vscode.workspace.fs.stat(sourcekitConfigFile);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            workspaceContext.outputChannel.appendLine(
                `Failed to read file at ${sourcekitConfigFile.fsPath}: ${error}`
            );
        }
        // Ignore, don't care if the file doesn't exist yet
    }

    try {
        const stats = await vscode.workspace.fs.stat(sourcekitFolder);
        if (stats.type !== vscode.FileType.Directory) {
            void vscode.window.showErrorMessage(
                `File ${sourcekitFolder.fsPath} already exists but is not a directory`
            );
            return false;
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            workspaceContext.outputChannel.appendLine(
                `Failed to read folder at ${sourcekitFolder.fsPath}: ${error}`
            );
        }
        await vscode.workspace.fs.createDirectory(sourcekitFolder);
    }
    const version = folderContext.toolchain.swiftVersion;
    const versionString = `${version.major}.${version.minor}`;
    let branch =
        configuration.lsp.configurationBranch ||
        (version.dev ? "main" : `release/${versionString}`);
    if (!(await checkURLExists(schemaURL(branch)))) {
        branch = "main";
    }
    await vscode.workspace.fs.writeFile(
        sourcekitConfigFile,
        Buffer.from(
            JSON.stringify(
                {
                    $schema: schemaURL(branch),
                },
                undefined,
                2
            )
        )
    );
    return true;
}

const schemaURL = (branch: string) =>
    `https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/${branch}/config.schema.json`;

async function checkURLExists(url: string): Promise<boolean> {
    try {
        const response = await fetch(url, { method: "HEAD" });
        return response.ok;
    } catch {
        return false;
    }
}
