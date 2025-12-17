//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

export async function createDocumentationCatalog(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        void vscode.window.showErrorMessage(
            "Creating a documentation catalog requires that a folder or workspace be opened"
        );
        return;
    }

    const moduleName = await vscode.window.showInputBox({
        prompt: "Enter Swift module name",
        placeHolder: "MyModule",
        validateInput: value =>
            value.trim().length === 0 ? "Module name cannot be empty" : undefined,
    });

    if (!moduleName) {
        return; // user cancelled
    }

    const rootPath = folders[0].uri.fsPath;
    const doccDir = path.join(rootPath, `${moduleName}.docc`);
    const markdownFile = path.join(doccDir, `${moduleName}.md`);

    if (fsSync.existsSync(doccDir)) {
        void vscode.window.showErrorMessage(
            `Documentation catalog "${moduleName}.docc" already exists.`
        );
        return;
    }

    await fs.mkdir(doccDir, { recursive: true });
    await fs.writeFile(markdownFile, `# ${moduleName}\n`, "utf8");

    void vscode.window.showInformationMessage(
        `Created DocC documentation catalog: ${moduleName}.docc`
    );
}
