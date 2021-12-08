//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Asynchronous wrapper around {@link cp.exec child_process.exec}.
 * 
 * Commands will be executed by the user's `$SHELL`, if configured.
 */
export async function exec(command: string, options: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
    options.shell = process.env.SHELL;
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => 
        cp.exec(command, options, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stdout, stderr });
            }
            resolve({ stdout, stderr });
        })
    );
}

/**
 * Extracts the base name of a repository from its URL.
 * 
 * The base name is the last path component of the URL, without the extension `.git`,
 * and without an optional trailing slash.
 */
export function getRepositoryName(url: string): string {
    // This regular expression consists of:
    // - any number of characters that aren't a slash: ([^/]*)
    // - optionally followed by a trailing slash: \/? 
    // - at the end of the URL: $
    const pattern = /([^/]*)\/?$/;
    // The capture group in this pattern will match the last path component of the URL.
    let lastPathComponent = url.match(pattern)![1];
    // Trim the optional .git extension.
    if (lastPathComponent.endsWith('.git')) {
        lastPathComponent = lastPathComponent.replace(/\.git$/, '');
    }
    return lastPathComponent;
}

/**
 * Whether the given path exists.
 * 
 * Does not check whether the user has permission to read the path.
 */
export async function pathExists(...pathComponents: string[]): Promise<boolean> {
    try {
        await fs.access(path.join(...pathComponents));
        return true;
    } catch {
        return false;
    }
}
