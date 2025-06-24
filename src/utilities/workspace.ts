//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2022 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { pathExists } from "./filesystem";
import { convertPathToPattern, glob } from "fast-glob";
import { basename } from "path";

export async function searchForPackages(
    folder: vscode.Uri,
    disableSwiftPMIntegration: boolean,
    searchSubfoldersForPackages: boolean
): Promise<Array<vscode.Uri>> {
    const folders: Array<vscode.Uri> = [];

    async function search(folder: vscode.Uri) {
        // add folder if Package.swift/compile_commands.json/compile_flags.txt/buildServer.json exists
        if (await isValidWorkspaceFolder(folder.fsPath, disableSwiftPMIntegration)) {
            folders.push(folder);
        }
        // should I search sub-folders for more Swift Packages
        if (!searchSubfoldersForPackages) {
            return;
        }

        const config = vscode.workspace.getConfiguration("files");
        const vscodeExcludeList = config.get<{ [key: string]: boolean }>("exclude", {});
        await glob(`${convertPathToPattern(folder.fsPath)}/*`, {
            ignore: [...Object.keys(vscodeExcludeList).filter(k => vscodeExcludeList[k])],
            absolute: true,
            onlyDirectories: true,
        }).then(async entries => {
            for (const entry of entries) {
                if (basename(entry) !== "." && basename(entry) !== "Packages") {
                    await search(vscode.Uri.file(entry));
                }
            }
        });
    }

    await search(folder);

    return folders;
}

export async function isValidWorkspaceFolder(
    folder: string,
    disableSwiftPMIntegration: boolean
): Promise<boolean> {
    return (
        (!disableSwiftPMIntegration && (await pathExists(folder, "Package.swift"))) ||
        (await pathExists(folder, "compile_commands.json")) ||
        (await pathExists(folder, "compile_flags.txt")) ||
        (await pathExists(folder, "buildServer.json")) ||
        (await pathExists(folder, "build")) ||
        (await pathExists(folder, "out"))
    );
}
