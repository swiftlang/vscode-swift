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
import * as path from "path";
import * as vscode from "vscode";

import { WorkspaceContext } from "./WorkspaceContext";
import { createSnippetConfiguration, debugLaunchConfig } from "./debugger/launch";
import { createSwiftTask } from "./tasks/SwiftTaskProvider";
import { TaskOperation } from "./tasks/TaskQueue";

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

async function debugSnippetWithOptions(
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
        folderContext.toolchain
    );
    const snippetDebugConfig = await createSnippetConfiguration(snippetName, folderContext);
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
        ctx.logger.error(`Failed to debug snippet: ${error}`);
        // ignore error if task failed to run
        return false;
    }
}
