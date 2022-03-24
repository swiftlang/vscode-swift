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

import * as vscode from "vscode";

/** sourcekit-lsp configuration */
export interface LSPConfiguration {
    /** Path to sourcekit-lsp executable */
    readonly serverPath: string;
    /** Arguments to pass to sourcekit-lsp executable */
    readonly serverArguments: string[];
    /** Toolchain to use with sourcekit-lsp */
    readonly toolchainPath: string;
}

/**
 * Type-safe wrapper around configuration settings.
 */
const configuration = {
    /** sourcekit-lsp configuration */
    get lsp(): LSPConfiguration {
        return {
            get serverPath(): string {
                return vscode.workspace
                    .getConfiguration("sourcekit-lsp")
                    .get<string>("serverPath", "");
            },
            get serverArguments(): string[] {
                return vscode.workspace
                    .getConfiguration("sourcekit-lsp")
                    .get<string[]>("serverArguments", []);
            },
            get toolchainPath(): string {
                return vscode.workspace
                    .getConfiguration("sourcekit-lsp")
                    .get<string>("toolchainPath", "");
            },
        };
    },

    /** Files and directories to exclude from the Package Dependencies view. */
    get excludePathsFromPackageDependencies(): string[] {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string[]>("excludePathsFromPackageDependencies", []);
    },
    /** Folders to exclude from package dependency view */
    set excludePathsFromPackageDependencies(value: string[]) {
        vscode.workspace
            .getConfiguration("swift")
            .update("excludePathsFromPackageDependencies", value);
    },
    /** Path to folder that include swift executable */
    get path(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("path", "");
    },
    /** swift build arguments */
    get buildArguments(): string[] {
        return vscode.workspace.getConfiguration("swift").get<string[]>("buildArguments", []);
    },
    /** include build errors in problems view */
    get problemMatchCompileErrors(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("problemMatchCompileErrors", true);
    },
    /** auto-generate launch.json configurations */
    get autoGenerateLaunchConfigurations(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("autoGenerateLaunchConfigurations", true);
    },
};

export default configuration;
