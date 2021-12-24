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
import { WorkspaceContext } from "./WorkspaceContext";
import { executeTaskAndWait, SwiftTaskProvider } from "./SwiftTaskProvider";

/**
 * References:
 *
 * - Contributing commands:
 *   https://code.visualstudio.com/api/references/contribution-points#contributes.commands
 * - Implementing commands:
 *   https://code.visualstudio.com/api/extension-guides/command
 */

// flags to indicating whether a resolve or update is in progress
let resolveRunning = false;
let updateRunning = false;

/**
 * Executes a {@link vscode.Task task} to resolve this package's dependencies.
 */
export async function resolveDependencies(ctx: WorkspaceContext) {
    // return if running resolve or update already
    if (resolveRunning || updateRunning) {
        return;
    }
    resolveRunning = true;

    const tasks = await vscode.tasks.fetchTasks();
    const task = tasks.find(task => task.name === SwiftTaskProvider.resolvePackageName)!;
    task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Silent,
    };
    ctx.outputChannel.logStart("Resolving Dependencies ... ");
    ctx.statusItem.start(task);
    try {
        await executeTaskAndWait(task);
        ctx.outputChannel.logEnd("done.");
    } catch (error) {
        ctx.outputChannel.logEnd(`${error}`);
    }
    ctx.statusItem.end(task);
    resolveRunning = false;
}

/**
 * Executes a {@link vscode.Task task} to update this package's dependencies.
 */
export async function updateDependencies(ctx: WorkspaceContext) {
    if (updateRunning) {
        return;
    }
    updateRunning = true;

    const tasks = await vscode.tasks.fetchTasks();
    const task = tasks.find(task => task.name === SwiftTaskProvider.updatePackageName)!;
    task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Silent,
    };
    ctx.outputChannel.logStart("Updating Dependencies ... ");
    ctx.statusItem.start(task);
    try {
        await executeTaskAndWait(task);
        ctx.outputChannel.logEnd("done.");
    } catch (error) {
        ctx.outputChannel.logEnd(`${error}`);
    }
    ctx.statusItem.end(task);
    updateRunning = false;
}

/**
 * Registers this extension's commands in the given {@link vscode.ExtensionContext context}.
 */
export function register(ctx: WorkspaceContext) {
    ctx.extensionContext.subscriptions.push(
        vscode.commands.registerCommand("swift.resolveDependencies", () => {
            resolveDependencies(ctx);
        }),
        vscode.commands.registerCommand("swift.updateDependencies", () => {
            updateDependencies(ctx);
        })
    );
}
