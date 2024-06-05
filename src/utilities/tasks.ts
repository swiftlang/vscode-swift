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

export function resolveTaskCwd(task: vscode.Task, cwd?: string): string | undefined {
    const scopeWorkspaceFolder = getScopeWorkspaceFolder(task);
    if (!cwd) {
        return scopeWorkspaceFolder;
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
    return;
}
