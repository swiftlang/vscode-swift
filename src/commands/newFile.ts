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
import { fileExists, pathExists } from "../utilities/filesystem";

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
        const defaultName = path.join(dir, defaultFileName);
        const givenPath = await vscode.window.showInputBox({
            value: defaultName,
            valueSelection: [dir.length + 1, defaultName.length - extension.length - 1],
            prompt: "Enter a file path to be created",
            validateInput: validatePathValid,
        });
        if (!givenPath) {
            return;
        }
        const targetUri = vscode.Uri.file(givenPath);
        try {
            await fs.writeFile(targetUri.fsPath, "", "utf-8");
            const document = await vscode.workspace.openTextDocument(targetUri);
            await vscode.languages.setTextDocumentLanguage(document, "swift");
            await vscode.window.showTextDocument(document);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create ${targetUri.fsPath}`);
        }
    } else {
        // If no path is supplied then open an untitled editor w/ Swift language type
        const document = await vscode.workspace.openTextDocument({
            language: "swift",
        });
        await vscode.window.showTextDocument(document);
    }
}

async function validatePathValid(input: string) {
    const inputPath = vscode.Uri.file(input).fsPath;
    const filePathExists = await fileExists(inputPath);
    if (filePathExists) {
        return `Supplied path ${inputPath} already exists`;
    }

    const inputDir = path.dirname(inputPath);
    const dirExists = await pathExists(inputDir);
    if (!dirExists) {
        return `Supplied directory ${inputDir} doesn't exist`;
    }

    return undefined;
}
