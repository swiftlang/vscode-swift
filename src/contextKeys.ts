//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";

/**
 * References:
 *
 * - `when` clause contexts:
 *   https://code.visualstudio.com/api/references/when-clause-contexts
 */

/**
 * Type-safe wrapper around context keys used in `when` clauses.
 */
const contextKeys = {
    /**
     * Whether or not the swift extension is activated.
     */
    set isActivated(value: boolean) {
        vscode.commands.executeCommand("setContext", "swift.isActivated", value);
    },

    /**
     * Whether the workspace folder contains a Swift package.
     */
    set hasPackage(value: boolean) {
        vscode.commands.executeCommand("setContext", "swift.hasPackage", value);
    },

    /**
     * Whether the Swift package has any dependencies to display in the Package Dependencies view.
     */
    set packageHasDependencies(value: boolean) {
        vscode.commands.executeCommand("setContext", "swift.packageHasDependencies", value);
    },

    /**
     * Whether the Swift package has any plugins.
     */
    set packageHasPlugins(value: boolean) {
        vscode.commands.executeCommand("setContext", "swift.packageHasPlugins", value);
    },

    /**
     * Whether current active file is in a SwiftPM source target folder
     */
    set currentTargetType(value: string | undefined) {
        vscode.commands.executeCommand("setContext", "swift.currentTargetType", value ?? "none");
    },

    /**
     * Whether current active file is a Snippet
     */
    set fileIsSnippet(value: boolean) {
        vscode.commands.executeCommand("setContext", "swift.fileIsSnippet", value);
    },

    /**
     * Whether current active file is a Snippet
     */
    set lldbVSCodeAvailable(value: boolean) {
        vscode.commands.executeCommand("setContext", "swift.lldbVSCodeAvailable", value);
    },

    /**
     * Whether the swift.createNewProject command is available.
     */
    set createNewProjectAvailable(value: boolean) {
        vscode.commands.executeCommand("setContext", "swift.createNewProjectAvailable", value);
    },

    /**
     * Whether the SourceKit-LSP server supports reindexing the workspace.
     */
    set supportsReindexing(value: boolean) {
        vscode.commands.executeCommand("setContext", "swift.supportsReindexing", value);
    },
};

export default contextKeys;
