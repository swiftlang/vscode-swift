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

import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

const extension = "swift";
const defaultFileName = `Untitled.${extension}`;

export async function newSwiftFile(
    uri?: vscode.Uri,
    isDirectory: (uri: vscode.Uri) => Promise<boolean> = async uri => {
        return (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory;
    }
) {
    if (uri) {
        // Attempt to create the file at the given directory.
        const dir = (await isDirectory(uri)) ? uri.fsPath : path.dirname(uri.fsPath);
        const defaultName = vscode.Uri.file(path.join(dir, defaultFileName));
        const targetUri = await vscode.window.showSaveDialog({
            defaultUri: defaultName,
            title: "Enter a file path to be created",
        });

        if (!targetUri) {
            return;
        }

        try {
            await fs.writeFile(targetUri.fsPath, "", "utf-8");
            const document = await vscode.workspace.openTextDocument(targetUri);
            await vscode.languages.setTextDocumentLanguage(document, "swift");
            await vscode.window.showTextDocument(document);
        } catch (err) {
            void vscode.window.showErrorMessage(`Failed to create ${targetUri.fsPath}`);
        }
    } else {
        // If no path is supplied then open an untitled editor w/ Swift language type
        const document = await vscode.workspace.openTextDocument({
            language: "swift",
        });
        await vscode.window.showTextDocument(document);
    }
}
