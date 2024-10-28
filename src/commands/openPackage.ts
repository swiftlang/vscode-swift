//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 Apple Inc. and the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { Version } from "../utilities/version";
import { fileExists } from "../utilities/filesystem";

/**
 * Open Package.swift for in focus project. If there is a version specific manifest that
 * matches the user's current Swift version that file is opened, otherwise opens Package.swift.
 * @param workspaceContext Workspace context, required to get current project
 */
export async function openPackage(swiftVersion: Version, currentFolder: vscode.Uri) {
    const packagePath = await packageSwiftFile(currentFolder, swiftVersion);
    if (packagePath) {
        const document = await vscode.workspace.openTextDocument(packagePath);
        vscode.window.showTextDocument(document);
    }
}

async function packageSwiftFile(
    currentFolder: vscode.Uri,
    version: Version
): Promise<vscode.Uri | null> {
    // Follow the logic outlined in the SPM documentation on version specific manifest selection
    // https://github.com/swiftlang/swift-package-manager/blob/main/Documentation/Usage.md#version-specific-manifest-selection
    const files = [
        `Package@swift-${version.major}.${version.minor}.${version.patch}.swift`,
        `Package@swift-${version.major}.${version.minor}.swift`,
        `Package@swift-${version.major}.swift`,
        "Package.swift",
    ].map(file => vscode.Uri.joinPath(currentFolder, file));

    for (const file of files) {
        if (await fileExists(file.fsPath)) {
            return file;
        }
    }
    return null;
}
