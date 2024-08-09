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

import * as fs from "fs/promises";
import * as path from "path";

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
export function expandFilePathTilda(filepath: string): string {
    if (process.platform !== "win32" && filepath[0] === "~" && process.env.HOME) {
        return path.join(process.env.HOME, filepath.slice(1));
    }
    return filepath;
}
