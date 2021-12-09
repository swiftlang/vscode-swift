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
import { SwiftContext } from  './SwiftContext';
import { Product } from './SwiftPackage';

/**
 * References:
 * 
 * - General information on tasks:
 *   https://code.visualstudio.com/docs/editor/tasks
 * - Contributing task definitions:
 *   https://code.visualstudio.com/api/references/contribution-points#contributes.taskDefinitions
 * - Implementing task providers:
 *   https://code.visualstudio.com/api/extension-guides/task-provider
 */

/**
 * Creates a {@link vscode.Task Task} to build all targets in this package.
 * This excludes test targets.
 */
function createBuildAllTask(): vscode.Task {
    return createSwiftTask('swift', ['build'], 'Build All', vscode.TaskGroup.Build);
}

/**
 * Creates a {@link vscode.Task Task} to clean the build artifacts.
 */
function createCleanTask(): vscode.Task {
    return createSwiftTask('swift', ['package', 'clean'], 'Clean Build Artifacts', vscode.TaskGroup.Clean);
}

/**
 * Creates a {@link vscode.Task Task} to run an executable target.
 */
 function createBuildTask(product: Product): vscode.Task {
    return createSwiftTask('swift', ['build', '--product', product.name], `Build ${product.name}`, vscode.TaskGroup.Build);
}

/**
 * Creates a {@link vscode.Task Task} to resolve the package dependencies.
 */
function createResolveTask(): vscode.Task {
    return createSwiftTask('swift', ['package', 'resolve'], 'Resolve Package Dependencies', undefined, ["$package-swift", "$package-swift-parse"]);
}

/**
 * Creates a {@link vscode.Task Task} to update the package dependencies.
 */
function createUpdateTask(): vscode.Task {
    return createSwiftTask('swift', ['package', 'update'], 'Update Package Dependencies');
}

/**
 * Helper function to create a {@link vscode.Task Task} with the given parameters.
 */
function createSwiftTask(command: string, args: string[], name: string, group?: vscode.TaskGroup, problemMatcher?: string|string[]): vscode.Task {
    let task = new vscode.Task(
        { type: 'swift', command: command, args: args },
        vscode.TaskScope.Workspace,
        name,
        'swift',
        new vscode.ShellExecution(command, args),
        problemMatcher
    );
    // This doesn't include any quotes added by VS Code.
    // See also: https://github.com/microsoft/vscode/issues/137895
    task.detail = `${command} ${args.join(' ')}`;
    task.group = group;
    return task;
}

/**
 * A {@link vscode.TaskProvider TaskProvider} for tasks that match the definition
 * in **package.json**: `{ type: 'swift'; command: string; args: string[] }`.
 * 
 * See {@link SwiftTaskProvider.provideTasks provideTasks} for a list of provided tasks.
 */
export class SwiftTaskProvider implements vscode.TaskProvider {

    constructor(private ctx: SwiftContext) { }

    /**
     * Provides tasks to run the following commands:
     * 
     * - `swift build`
     * - `swift package clean`
     * - `swift package resolve`
     * - `swift package update`
     * - `swift run ${target}` for every executable target
     */
    async provideTasks(token: vscode.CancellationToken): Promise<vscode.Task[]> {
        let tasks = [
            createBuildAllTask(),
            createCleanTask(),
            createResolveTask(),
            createUpdateTask()
        ];
        const executables = this.ctx.swiftPackage.executableProducts;
        for (const executable of executables) {
            tasks.push(createBuildTask(executable));
        }
        return tasks;
    }

    /**
     * Resolves a {@link vscode.Task Task} specified in **tasks.json**.
     * 
     * Other than its definition, this `Task` may be incomplete,
     * so this method should fill in the blanks.
     */
    resolveTask(task: vscode.Task, token: vscode.CancellationToken): vscode.Task {
        // We need to create a new Task object here.
        // Reusing the task parameter doesn't seem to work.
        let newTask = new vscode.Task(
            task.definition,
            vscode.TaskScope.Workspace,
            task.name || 'Custom Task',
            'swift',
            new vscode.ShellExecution(task.definition.command, task.definition.args)
        );
        newTask.detail = task.detail ?? `${task.definition.command} ${task.definition.args.join(' ')}`;
        newTask.group = task.group;
        return newTask;
    }
}
