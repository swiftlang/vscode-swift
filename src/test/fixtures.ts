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

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Returns the {@link vscode.Uri URI} of a resource in the **test** directory.
 */
export function getTestResourceUri(name: string): vscode.Uri {
    return vscode.Uri.file(path.resolve(__dirname, '../../test', name));
}

/**
 * Reads the contents of a resource in the **test** directory
 * and returns it as a `string`.
 */
export async function loadTestResourceAsString(name: string): Promise<string> {
    const path = getTestResourceUri(name).fsPath;
    return fs.readFile(path, 'utf8');
}
