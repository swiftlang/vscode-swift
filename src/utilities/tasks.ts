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
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { substituteVariablesInString } from "../configuration";

export const lineBreakRegex = /\r\n|\n|\r/gm;

export function resolveTaskCwd(task: vscode.Task, cwd?: string): string | undefined {
    const scopeWorkspaceFolder = getScopeWorkspaceFolder(task);
    if (!cwd) {
        return scopeWorkspaceFolder;
    }

    if (/\$\{.*\}/g.test(cwd)) {
        return substituteVariablesInString(cwd);
    }

    if (path.isAbsolute(cwd)) {
        return cwd;
    } else if (scopeWorkspaceFolder) {
        return path.join(scopeWorkspaceFolder, cwd);
    }
    return cwd;
}

function getScopeWorkspaceFolder(task: vscode.Task): string | undefined {
    if (task.scope !== vscode.TaskScope.Global && task.scope !== vscode.TaskScope.Workspace) {
        const scopeWorkspaceFolder = task.scope as vscode.WorkspaceFolder;
        return scopeWorkspaceFolder.uri.fsPath;
    }
    return undefined;
}

export function getPlatformConfig<T>(task: vscode.Task): T | undefined {
    if (process.platform === "win32") {
        return task.definition.windows;
    } else if (process.platform === "linux") {
        return task.definition.linux;
    } else if (process.platform === "darwin") {
        return task.definition.macos;
    }
}

export function checkIfBuildComplete(line: string): boolean {
    // Output in this format for "build" and "test" commands
    const completeRegex = /^Build complete!/gm;
    let match = completeRegex.exec(line);
    if (match) {
        return true;
    }
    // Output in this format for "run" commands
    const productCompleteRegex = /^Build of product '.*' complete!/gm;
    match = productCompleteRegex.exec(line);
    if (match) {
        return true;
    }
    return false;
}

export function packageName(folderContext: FolderContext): string | undefined {
    if (vscode.workspace.workspaceFile) {
        return folderContext.name;
    } else if (folderContext.relativePath.length > 0) {
        return folderContext.relativePath;
    }
}

export function resolveScope(scope: vscode.WorkspaceFolder | vscode.TaskScope) {
    if (vscode.workspace.workspaceFile) {
        return vscode.TaskScope.Workspace;
    }
    return scope;
}
