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
import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

type DoccLocationPickItem = vscode.QuickPickItem & {
    basePath: string;
};

export async function createDocumentationCatalog(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        void vscode.window.showErrorMessage(
            "Creating a documentation catalog requires that a folder or workspace be opened."
        );
        return;
    }

    let folder: vscode.WorkspaceFolder | undefined;

    if (folders.length === 1) {
        folder = folders[0];
    } else {
        folder = await vscode.window.showWorkspaceFolderPick({
            placeHolder: "Select a workspace folder to create the DocC catalog in",
        });
    }

    if (!folder) {
        return;
    }

    const rootPath = folder.uri.fsPath;

    let hasPackageSwift = true;
    try {
        await fs.access(path.join(rootPath, "Package.swift"));
    } catch {
        hasPackageSwift = false;
    }

    let targets: string[] = [];

    if (hasPackageSwift) {
        try {
            const { stdout } = await execFileAsync("swift", ["package", "dump-package"], {
                cwd: rootPath,
            });

            const pkg = JSON.parse(stdout);
            targets = pkg.targets.map((t: { name: string }) => t.name);
        } catch {
            // If SwiftPM fails, fall back to standalone
            targets = [];
        }
    }

    const items: DoccLocationPickItem[] = [];

    for (const name of targets) {
        const srcPath = path.join(rootPath, "Sources", name);
        try {
            await fs.access(srcPath);
            items.push({
                label: `Target: ${name}`,
                description: `Sources/${name}`,
                basePath: srcPath,
            });
        } catch {
            //skip
        }

        const testPath = path.join(rootPath, "Tests", name);
        try {
            await fs.access(testPath);
            items.push({
                label: `Target: ${name}`,
                description: `Tests/${name}`,
                basePath: testPath,
            });
        } catch {
            //skip
        }
    }

    items.push({
        label: "Standalone documentation catalog",
        description: "Workspace root",
        basePath: rootPath,
    });

    const selection = await vscode.window.showQuickPick<DoccLocationPickItem>(items, {
        placeHolder: "Select where to create the documentation catalog",
    });

    if (!selection) {
        return;
    }

    const basePath = selection.basePath;

    const moduleName = await vscode.window.showInputBox({
        prompt: "Enter Swift module name",
        placeHolder: "MyModule",
        validateInput: async value => {
            if (value.trim().length === 0) {
                return "Module name cannot be empty";
            }

            const doccDir = path.join(basePath, `${value}.docc`);
            try {
                await fs.access(doccDir);
                return `Documentation catalog "${value}.docc" already exists`;
            } catch {
                // does not exist → OK
                return undefined;
            }
        },
    });

    if (!moduleName) {
        return; // user cancelled
    }

    const doccDir = path.join(basePath, `${moduleName}.docc`);
    const markdownFile = path.join(doccDir, `${moduleName}.md`);

    await fs.mkdir(doccDir, { recursive: true });
    await fs.writeFile(markdownFile, `# ${moduleName}\n`, "utf8");

    void vscode.window.showInformationMessage(
        `Created DocC documentation catalog: ${moduleName}.docc`
    );
}
