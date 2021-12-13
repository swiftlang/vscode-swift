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
import * as debug from './debug';
import { WorkspaceContext } from './WorkspaceContext';
import { executeTaskAndWait } from './SwiftTaskProvider';

/**
 * References:
 * 
 * - Contributing commands:
 *   https://code.visualstudio.com/api/references/contribution-points#contributes.commands
 * - Implementing commands:
 *   https://code.visualstudio.com/api/extension-guides/command
 */

// flags to indicating whether a resolve or update is in progress
var resolveRunning = false;
var updateRunning = false;

/**
 * Executes a {@link vscode.Task task} to resolve this package's dependencies.
 */
export async function resolveDependencies(ctx: WorkspaceContext) {
    // return if running resolve or update already
    if (resolveRunning || updateRunning) { return; }
    resolveRunning = true;

    try {
        ctx.outputChannel.append("Resolving Dependencies ... ");
        let tasks = await vscode.tasks.fetchTasks();
        let task = tasks.find(task =>
            task.definition.command === 'swift' &&
            task.definition.args[0] === 'package' &&
            task.definition.args[1] === 'resolve'
        )!;
        await executeTaskAndWait(task);
        ctx.outputChannel.appendLine("done.");
    } catch(error) {
        ctx.outputChannel.appendLine(`${error}`);
    }
    resolveRunning = false;
}

/**
 * Executes a {@link vscode.Task task} to update this package's dependencies.
 */
export async function updateDependencies(ctx: WorkspaceContext) {
    if (updateRunning) { return; }
    updateRunning = true;

    try {
        ctx.outputChannel.append("Updating Dependencies ... ");
        let tasks = await vscode.tasks.fetchTasks();
        let task = tasks.find(task =>
            task.definition.command === 'swift' &&
            task.definition.args[0] === 'package' &&
            task.definition.args[1] === 'update'
        )!;
        await executeTaskAndWait(task);
        ctx.outputChannel.appendLine("done.");
    } catch(error) {
        ctx.outputChannel.appendLine(`${error}`);
    }
    updateRunning = false;
}

/**
 * Registers this extension's commands in the given {@link vscode.ExtensionContext context}.
 */
export function register(ctx: WorkspaceContext) {
    ctx.extensionContext.subscriptions.push(
        vscode.commands.registerCommand('swift.resolveDependencies', () => { resolveDependencies(ctx); }),
        vscode.commands.registerCommand('swift.updateDependencies', () => { updateDependencies(ctx); }),
    );
}
