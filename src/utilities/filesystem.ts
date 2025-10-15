//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { Options, convertPathToPattern, glob as fastGlob } from "fast-glob";
import * as fs from "fs/promises";
import { contains } from "micromatch";
import * as path from "path";
import * as vscode from "vscode";

import configuration from "../configuration";

export const validFileTypes = ["swift", "c", "cpp", "h", "hpp", "m", "mm"];

/**
 * Checks if a file, directory or symlink exists at the supplied path.
 * @param pathComponents The path to check for existence
 * @returns Whether or not an entity exists at the path
 */
export async function pathExists(...pathComponents: string[]): Promise<boolean> {
    try {
        await fs.access(path.join(...pathComponents));
        return true;
    } catch {
        return false;
    }
}

/**
 * Checks if a file exists at the supplied path.
 * @param pathComponents The file path to check for existence
 * @returns Whether or not the file exists at the path
 */
export async function fileExists(...pathComponents: string[]): Promise<boolean> {
    try {
        return (await fs.stat(path.join(...pathComponents))).isFile();
    } catch (e) {
        return false;
    }
}

/**
 * Checks if a file exists on disk and, if it doesn't, creates it. If the file does exist
 * then this function does nothing.
 * @param path The path to the file.
 */
export async function touch(path: string): Promise<void> {
    if (!(await fileExists(path))) {
        const handle = await fs.open(path, "a");
        await handle.close();
    }
}

/**
 * Return whether a file/folder is inside a folder.
 * @param subpath child file/folder
 * @param parent parent folder
 * @returns if child file/folder is inside the parent folder
 */
export function isPathInsidePath(subpath: string, parent: string): boolean {
    // return true if path doesn't start with '..'
    return !path.relative(parent, subpath).startsWith("..");
}

/**
 * Expand ~ in file path to full $HOME folder
 * @param filepath File path
 * @returns full path
 */
export function expandFilePathTilde(
    filepath: string,
    directory: string | null = process.env.HOME ?? null,
    platform: NodeJS.Platform = process.platform
): string {
    // Guard no expanding on windows
    if (platform === "win32") {
        return filepath;
    }
    // Guard tilde is present
    if (filepath[0] !== "~") {
        return filepath;
    }
    // Guard we know home directory
    if (!directory) {
        return filepath;
    }
    return path.join(directory, filepath.slice(1));
}

function getDefaultExcludeList(): Record<string, boolean> {
    const config = vscode.workspace.getConfiguration("files");
    const vscodeExcludeList = config.get<{ [key: string]: boolean }>("exclude", {});
    const swiftExcludeList = configuration.excludePathsFromActivation;
    return { ...vscodeExcludeList, ...swiftExcludeList };
}

function getGlobPattern(excludeList: Record<string, boolean>): {
    include: string[];
    exclude: string[];
} {
    const exclude: string[] = [];
    const include: string[] = [];
    for (const key of Object.keys(excludeList)) {
        if (excludeList[key]) {
            exclude.push(key);
        } else {
            include.push(key);
        }
    }
    return { include, exclude };
}

export function isIncluded(
    uri: vscode.Uri,
    excludeList: Record<string, boolean> = getDefaultExcludeList()
): boolean {
    let notExcluded = true;
    let included = true;
    for (const key of Object.keys(excludeList)) {
        if (excludeList[key]) {
            if (contains(uri.fsPath, key, { contains: true })) {
                notExcluded = false;
                included = false;
            }
        } else {
            if (contains(uri.fsPath, key, { contains: true })) {
                included = true;
            }
        }
    }
    if (notExcluded) {
        return true;
    }
    return included;
}

export function isExcluded(
    uri: vscode.Uri,
    excludeList: Record<string, boolean> = getDefaultExcludeList()
): boolean {
    return !isIncluded(uri, excludeList);
}

export async function globDirectory(uri: vscode.Uri, options?: Options): Promise<string[]> {
    const { include, exclude } = getGlobPattern(getDefaultExcludeList());
    const matches: string[] = await fastGlob(`${convertPathToPattern(uri.fsPath)}/*`, {
        ignore: exclude,
        absolute: true,
        ...options,
    });
    if (include.length > 0) {
        matches.push(
            ...(await fastGlob(include, {
                absolute: true,
                cwd: uri.fsPath,
                ...options,
            }))
        );
    }
    return matches;
}
