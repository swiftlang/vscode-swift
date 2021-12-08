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
import { SwiftContext } from './SwiftContext';
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
 * Contains the commands defined in this extension.
 */ 
const commands = {

    /**
     * Executes a {@link vscode.Task task} to resolve this package's dependencies.
     */
    async resolveDependencies() {
        // return if running resolve or update already
        if (resolveRunning || updateRunning) { return; }
        resolveRunning = true;

        let tasks = await vscode.tasks.fetchTasks();
        let task = tasks.find(task =>
            task.definition.command === 'swift' &&
            task.definition.args[0] === 'package' &&
            task.definition.args[1] === 'resolve'
        )!;
        await executeTaskAndWait(task);

        resolveRunning = false;
    },

    async generateLaunchConfig(ctx: SwiftContext) {
        await debug.makeDebugConfigurations(ctx);
    },

    /**
     * Executes a {@link vscode.Task task} to update this package's dependencies.
     */
    async updateDependencies() {
        if (updateRunning) { return; }
        updateRunning = true;

        let tasks = await vscode.tasks.fetchTasks();
        let task = tasks.find(task =>
            task.definition.command === 'swift' &&
            task.definition.args[0] === 'package' &&
            task.definition.args[1] === 'update'
        )!;
        await executeTaskAndWait(task);

        updateRunning = false;
    },

    /**
     * Registers this extension's commands in the given {@link vscode.ExtensionContext context}.
     */
    register(ctx: SwiftContext) {
        ctx.extensionContext.subscriptions.push(
            vscode.commands.registerCommand('swift.resolveDependencies', this.resolveDependencies),
            vscode.commands.registerCommand('swift.updateDependencies', this.updateDependencies),
            vscode.commands.registerCommand('swift.generateLaunchConfig', this.generateLaunchConfig.bind(this, ctx)),
        );
    }
};

export default commands;
