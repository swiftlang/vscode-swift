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
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { WorkspaceContext } from "../WorkspaceContext";
import { selectFolder } from "../ui/SelectFolderQuickPick";
import { folderExists, pathExists } from "../utilities/filesystem";

type DoccLocationPickItem = vscode.QuickPickItem & {
    basePath: string;
    targetName?: string;
};

export async function createDocumentationCatalog(
    ctx: WorkspaceContext,
    folderContext?: FolderContext
): Promise<void> {
    let folder: FolderContext | undefined = folderContext;

    // Only auto-pick when there's exactly one workspace folder
    if (!folder && ctx.folders.length === 1) {
        folder = ctx.folders[0];
    }

    if (!folder) {
        if (ctx.folders.length === 0) {
            void vscode.window.showErrorMessage(
                "Creating a documentation catalog requires an open workspace folder."
            );
            return;
        }

        const selected = await selectFolder(
            ctx,
            "Select a workspace folder to create the DocC catalog in"
        );

        if (selected.length !== 1) {
            return;
        }

        folder = selected[0];
    }

    // ---- workspace folder resolution (standard pattern) ----
    if (!folder) {
        if (ctx.folders.length === 0) {
            void vscode.window.showErrorMessage(
                "Creating a documentation catalog requires an open workspace folder."
            );
            return;
        }

        if (ctx.folders.length === 1) {
            folder = ctx.folders[0];
        } else {
            const selected = await selectFolder(
                ctx,
                "Select a workspace folder to create the DocC catalog in",
                { all: "" }
            );
            if (selected.length !== 1) {
                return;
            }
            folder = selected[0];
        }
    }

    const rootPath = folder.folder.fsPath;

    // ---- build QuickPick items from swiftPackage (PROMISE) ----
    const itemsPromise = (async () => {
        const items: DoccLocationPickItem[] = [];

        if (folder.swiftPackage) {
            const targets = await folder.swiftPackage.getTargets();

            for (const target of targets) {
                const base = path.join(rootPath, target.path);
                if (await folderExists(base)) {
                    items.push({
                        label: `Target: ${target.name}`,
                        description: target.type,
                        detail: target.path,
                        basePath: base,
                        targetName: target.name,
                    });
                }
            }
        }

        items.push({
            label: "Standalone documentation catalog",
            description: "Workspace root",
            basePath: rootPath,
        });

        return items;
    })();

    // ---- show QuickPick (toolchain-style pattern) ----
    const selection = await vscode.window.showQuickPick(itemsPromise, {
        title: "Create DocC Documentation Catalog",
        placeHolder: "Select where to create the documentation catalog.",
        canPickMany: false,
    });

    if (!selection) {
        return;
    }

    const basePath = selection.basePath;

    // ---- module name input ----
    let moduleName: string;

    if (selection.targetName) {
        // Target-based DocC: module name must match target
        moduleName = selection.targetName;
    } else {
        // Standalone DocC: ask user
        const input = await vscode.window.showInputBox({
            prompt: "Enter Swift module name",
            placeHolder: "MyModule",
            validateInput: async value => {
                const name = value.trim();
                if (name.length === 0) {
                    return "Module name cannot be empty";
                }

                const doccDir = path.join(basePath, `${name}.docc`);
                if (await pathExists(doccDir)) {
                    return `Documentation catalog "${name}.docc" already exists`;
                }

                return undefined;
            },
        });

        if (!input) {
            return;
        }

        moduleName = input.trim();
    }

    const doccDir = path.join(basePath, `${moduleName}.docc`);
    const markdownFile = path.join(doccDir, `${moduleName}.md`);

    // ---- execution-time guard (race-safe) ----
    if (await pathExists(doccDir)) {
        void vscode.window.showErrorMessage(
            `Documentation catalog "${moduleName}.docc" already exists`
        );
        return;
    }

    await fs.mkdir(doccDir);
    await fs.writeFile(markdownFile, `# ${moduleName}\n`, "utf8");

    void vscode.window.showInformationMessage(
        `Created DocC documentation catalog: ${moduleName}.docc`
    );
}
