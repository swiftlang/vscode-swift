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
import * as fs from "fs/promises";
import * as path from "path";
import { basename } from "path";
import * as vscode from "vscode";

import { globDirectory, pathExists } from "./filesystem";
import { Version } from "./version";

export async function searchForPackages(
    folder: vscode.Uri,
    disableSwiftPMIntegration: boolean,
    searchSubfoldersForPackages: boolean,
    skipFolders: Array<string>,
    swiftVersion: Version
): Promise<Array<vscode.Uri>> {
    const folders: Array<vscode.Uri> = [];

    async function search(folder: vscode.Uri) {
        // add folder if Package.swift/compile_commands.json/compile_flags.txt/buildServer.json/.bsp exists
        if (await isValidWorkspaceFolder(folder.fsPath, disableSwiftPMIntegration, swiftVersion)) {
            folders.push(folder);
        }

        // If sub-folder searches are disabled, don't search subdirectories
        if (!searchSubfoldersForPackages) {
            return;
        }

        await globDirectory(folder, "*", { onlyDirectories: true }).then(async entries => {
            const skip = new Set<string>(skipFolders);
            for (const entry of entries) {
                const base = basename(entry);
                if (!skip.has(base)) {
                    await search(vscode.Uri.file(entry));
                }
            }
        });
    }

    await search(folder);

    return folders;
}

async function hasBSPConfigurationFile(folder: string, swiftVersion: Version): Promise<boolean> {
    // buildServer.json
    const buildServerPath = path.join(folder, "buildServer.json");
    const buildServerStat = await fs.stat(buildServerPath).catch(() => undefined);
    if (buildServerStat && buildServerStat.isFile()) {
        return true;
    }
    // .bsp/*.json for Swift >= 6.1.0
    if (swiftVersion.isGreaterThanOrEqual(new Version(6, 1, 0))) {
        const bspDir = path.join(folder, ".bsp");
        const bspStat = await fs.stat(bspDir).catch(() => undefined);
        if (bspStat && bspStat.isDirectory()) {
            const files = await fs.readdir(bspDir).catch(() => []);
            if (files.some(f => f.endsWith(".json"))) {
                return true;
            }
        }
    }
    return false;
}

export async function isValidWorkspaceFolder(
    folder: string,
    disableSwiftPMIntegration: boolean,
    swiftVersion: Version
): Promise<boolean> {
    // Check Package.swift first (most common case)
    if (!disableSwiftPMIntegration && (await pathExists(folder, "Package.swift"))) {
        return true;
    }

    // Check other common build files
    if (await pathExists(folder, "compile_commands.json")) {
        return true;
    }

    if (await pathExists(folder, "compile_flags.txt")) {
        return true;
    }

    // Check for compile_commands.json inside common build directories.
    // The default search paths (root ".", "build/") match SourceKit-LSP
    // and clangd behavior (see DetermineBuildServer.swift in sourcekit-lsp).
    // We additionally check "out/" as a common CMake build directory name.
    // Only match if the actual compile_commands.json file exists, not just
    // the directory, to avoid false positives with non-Swift projects (e.g. Flutter).
    if (await pathExists(folder, "build", "compile_commands.json")) {
        return true;
    }

    if (await pathExists(folder, "out", "compile_commands.json")) {
        return true;
    }

    // Check BSP configuration last (potentially more expensive)
    if (await hasBSPConfigurationFile(folder, swiftVersion)) {
        return true;
    }

    return false;
}

/**
 * Finds all `.swift-version` files within the given folder, or across every workspace folder
 * when no folder is provided.
 * @param folder Optional folder to search; when omitted every workspace folder is searched
 * @returns Absolute paths to the discovered `.swift-version` files
 */
export function findSwiftVersionFiles(folder?: vscode.Uri): Promise<string[]> {
    const folders = folder
        ? [folder]
        : (vscode.workspace.workspaceFolders ?? []).map(workspaceFolder => workspaceFolder.uri);
    return Promise.all(
        folders.map(uri =>
            globDirectory(uri, "**/.swift-version", { absolute: true, onlyFiles: true })
        )
    ).then(results => results.flat());
}

/**
 * Reads the Swift version named in each of the given `.swift-version` files, returning the
 * unique, non-empty version names.
 * @param files Absolute paths to `.swift-version` files
 * @returns The deduplicated Swift version names
 */
export async function readSwiftVersions(files: string[]): Promise<string[]> {
    const versions = await Promise.all(
        files.map(async file => (await fs.readFile(file, "utf-8")).trim())
    );
    return [...new Set(versions.filter(version => version.length > 0))];
}
