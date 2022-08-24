//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2022 the VSCode Swift project authors
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
import { createSnippetConfigurations } from "./debugger/launch";

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

export async function runSnippet(ctx: WorkspaceContext) {
    const folderContext = ctx.currentFolder;
    if (!ctx.currentDocument || !folderContext) {
        return;
    }
    const snippetName = path.basename(ctx.currentDocument.fsPath, ".swift");
    const snippetTask = createSwiftTask(["run", snippetName], `Run ${snippetName}`, {
        group: vscode.TaskGroup.Test,
        cwd: folderContext.folder,
        scope: folderContext.workspaceFolder,
        presentationOptions: {
            reveal: vscode.TaskRevealKind.Always,
        },
        problemMatcher: configuration.problemMatchCompileErrors ? "$swiftc" : undefined,
    });

    await vscode.tasks.executeTask(snippetTask);
}

export async function debugSnippet(ctx: WorkspaceContext) {
    const folderContext = ctx.currentFolder;
    if (!ctx.currentDocument || !folderContext) {
        return;
    }

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
        }
    );

    await folderContext.taskQueue.queueOperation({ task: snippetBuildTask }).then(result => {
        if (result === 0) {
            const snippetDebugConfig = createSnippetConfigurations(snippetName, folderContext);

            return new Promise<void>((resolve, reject) => {
                vscode.debug.startDebugging(folderContext.workspaceFolder, snippetDebugConfig).then(
                    started => {
                        if (started) {
                            const terminateSession = vscode.debug.onDidTerminateDebugSession(
                                async () => {
                                    // dispose terminate debug handler
                                    terminateSession.dispose();
                                    resolve();
                                }
                            );
                        }
                    },
                    reason => {
                        reject(reason);
                    }
                );
            });
        }
    });
}
