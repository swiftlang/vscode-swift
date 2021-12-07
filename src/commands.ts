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
import { SwiftContext, Command } from './SwiftContext';

/**
 * References:
 * 
 * - Contributing commands:
 *   https://code.visualstudio.com/api/references/contribution-points#contributes.commands
 * - Implementing commands:
 *   https://code.visualstudio.com/api/extension-guides/command
 */

/**
 * Contains the commands defined in this extension.
 */
const commands = {

    /**
     * Executes a {@link vscode.Task task} to resolve this package's dependencies.
     */
    async resolveDependencies() {
        let tasks = await vscode.tasks.fetchTasks();
        let task = tasks.find(task =>
            task.definition.command === 'swift' &&
            task.definition.args[0] === 'package' &&
            task.definition.args[1] === 'resolve'
        )!;
        vscode.tasks.executeTask(task);
    },

    makeDebugConfig(ctx: SwiftContext): Command {
        return async() => {
            await debug.makeDebugConfigurations(ctx);
        };
    },

    /**
     * Executes a {@link vscode.Task task} to update this package's dependencies.
     */
    async updateDependencies() {
        let tasks = await vscode.tasks.fetchTasks();
        let task = tasks.find(task =>
            task.definition.command === 'swift' &&
            task.definition.args[0] === 'package' &&
            task.definition.args[1] === 'update'
        )!;
        vscode.tasks.executeTask(task);
    },

    /**
     * Registers this extension's commands in the given {@link vscode.ExtensionContext context}.
     */
    register(ctx: SwiftContext) {
        ctx.extensionContext.subscriptions.push(
            vscode.commands.registerCommand('swift.resolveDependencies', this.resolveDependencies),
            vscode.commands.registerCommand('swift.updateDependencies', this.updateDependencies),
            ctx.registerCommand("makeDebugConfig", this.makeDebugConfig)
        );
    }
};

export default commands;
