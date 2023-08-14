//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2022-2023 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as path from "path";
import contextKeys from "./contextKeys";
import { createSwiftTask } from "./SwiftTaskProvider";
import { WorkspaceContext } from "./WorkspaceContext";
import configuration from "./configuration";
import { createSnippetConfiguration, debugLaunchConfig } from "./debugger/launch";

/**
 * Set context key indicating whether current file is a Swift Snippet
 * @param ctx Workspace context
 */
export function setSnippetContextKey(ctx: WorkspaceContext) {
    if (
        ctx.swiftVersion.isLessThan({ major: 5, minor: 7, patch: 0 }) ||
        !ctx.currentFolder ||
        !ctx.currentDocument
    ) {
        contextKeys.fileIsSnippet = false;
        return;
    }

    const filename = ctx.currentDocument.fsPath;
    const snippetsFolder = path.join(ctx.currentFolder.folder.fsPath, "Snippets");
    if (filename.startsWith(snippetsFolder)) {
        contextKeys.fileIsSnippet = true;
    } else {
        contextKeys.fileIsSnippet = false;
    }
    return;
}

/**
 * If current file is a Swift Snippet run it
 * @param ctx Workspace Context
 */
export async function runSnippet(ctx: WorkspaceContext) {
    const folderContext = ctx.currentFolder;
    if (!ctx.currentDocument || !folderContext) {
        return;
    }
    // create run task
    const snippetName = path.basename(ctx.currentDocument.fsPath, ".swift");
    const snippetTask = createSwiftTask(
        ["run", snippetName],
        `Run ${snippetName}`,
        {
            group: vscode.TaskGroup.Test,
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            presentationOptions: {
                reveal: vscode.TaskRevealKind.Always,
            },
            problemMatcher: configuration.problemMatchCompileErrors ? "$swiftc" : undefined,
        },
        ctx.toolchain
    );

    await vscode.tasks.executeTask(snippetTask);
}

/**
 * If current file is a Swift Snippet run it in the debugger
 * @param ctx Workspace Context
 */
export async function debugSnippet(ctx: WorkspaceContext) {
    const folderContext = ctx.currentFolder;
    if (!ctx.currentDocument || !folderContext) {
        return;
    }

    // create build task
    const snippetName = path.basename(ctx.currentDocument.fsPath, ".swift");
    const snippetBuildTask = createSwiftTask(
        ["build", "--target", snippetName],
        `Build ${snippetName}`,
        {
            group: vscode.TaskGroup.Build,
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            presentationOptions: {
                reveal: vscode.TaskRevealKind.Always,
            },
            problemMatcher: configuration.problemMatchCompileErrors ? "$swiftc" : undefined,
        },
        ctx.toolchain
    );

    // queue build task and when it is complete run executable in the debugger
    await folderContext.taskQueue.queueOperation({ task: snippetBuildTask }).then(result => {
        if (result === 0) {
            const snippetDebugConfig = createSnippetConfiguration(snippetName, folderContext);
            return debugLaunchConfig(snippetDebugConfig, folderContext.workspaceFolder);
        }
    });
}
