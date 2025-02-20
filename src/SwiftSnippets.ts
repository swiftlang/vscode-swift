//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2022-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as path from "path";
import contextKeys from "./contextKeys";
import { createSwiftTask } from "./tasks/SwiftTaskProvider";
import { WorkspaceContext } from "./WorkspaceContext";
import { createSnippetConfiguration, debugLaunchConfig } from "./debugger/launch";
import { TaskOperation } from "./tasks/TaskQueue";

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
export async function runSnippet(
    ctx: WorkspaceContext,
    snippet?: string
): Promise<boolean | undefined> {
    return await debugSnippetWithOptions(ctx, { noDebug: true }, snippet);
}

/**
 * If current file is a Swift Snippet run it in the debugger
 * @param ctx Workspace Context
 */
export async function debugSnippet(
    ctx: WorkspaceContext,
    snippet?: string
): Promise<boolean | undefined> {
    return await debugSnippetWithOptions(ctx, {}, snippet);
}

export async function debugSnippetWithOptions(
    ctx: WorkspaceContext,
    options: vscode.DebugSessionOptions,
    snippet?: string
): Promise<boolean | undefined> {
    // create build task
    let snippetName: string;
    if (snippet) {
        snippetName = snippet;
    } else if (ctx.currentDocument) {
        snippetName = path.basename(ctx.currentDocument.fsPath, ".swift");
    } else {
        return false;
    }

    const folderContext = ctx.currentFolder;
    if (!folderContext) {
        return false;
    }

    const snippetBuildTask = createSwiftTask(
        ["build", "--product", snippetName],
        `Build ${snippetName}`,
        {
            group: vscode.TaskGroup.Build,
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            presentationOptions: {
                reveal: vscode.TaskRevealKind.Always,
            },
        },
        ctx.toolchain
    );
    const snippetDebugConfig = createSnippetConfiguration(snippetName, folderContext);
    try {
        ctx.buildStarted(snippetName, snippetDebugConfig, options);

        // queue build task and when it is complete run executable in the debugger
        return await folderContext.taskQueue
            .queueOperation(new TaskOperation(snippetBuildTask))
            .then(result => {
                if (result === 0) {
                    return debugLaunchConfig(
                        folderContext.workspaceFolder,
                        snippetDebugConfig,
                        options
                    );
                }
            })
            .then(result => {
                ctx.buildFinished(snippetName, snippetDebugConfig, options);
                return result;
            });
    } catch (error) {
        ctx.outputChannel.appendLine(`Failed to debug snippet: ${error}`);
        // ignore error if task failed to run
        return false;
    }
}
