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

/**
 * Type-safe wrapper around configuration settings.
 */
const configuration = {

    /**
     * Files and directories to exclude from the Package Dependencies view.
     */
    get excludePathsFromPackageDependencies(): string[] {
        return vscode.workspace.getConfiguration('swift').get<string[]>('excludePathsFromPackageDependencies', []);
    },
    set excludePathsFromPackageDependencies(value: string[]) {
        vscode.workspace.getConfiguration('swift').update('excludePathsFromPackageDependencies', value);
    },
    get path(): string {
        return vscode.workspace.getConfiguration('swift').get<string>('path', '');
    },
    get buildArguments(): string[] {
        return vscode.workspace.getConfiguration('swift').get<string[]>('buildArguments', []);
    }
};

export default configuration;
