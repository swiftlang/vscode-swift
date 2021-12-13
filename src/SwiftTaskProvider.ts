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
import { WorkspaceContext } from  './WorkspaceContext';
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

// Interface class for defining task configuration
interface TaskConfig {
    scope?: vscode.TaskScope
    group?: vscode.TaskGroup
    problemMatcher?: string|string[]
    presentationOptions?: vscode.TaskPresentationOptions 
}

/**
 * Creates a {@link vscode.Task Task} to build all targets in this package.
 * This excludes test targets.
 */
function createBuildAllTask(): vscode.Task {
    return createSwiftTask(
        'swift', 
        ['build'], 
        'Build All', 
        { group: vscode.TaskGroup.Build }
    );
}

/**
 * Creates a {@link vscode.Task Task} to clean the build artifacts.
 */
function createCleanTask(): vscode.Task {
    return createSwiftTask(
        'swift', 
        ['package', 'clean'], 
        'Clean Build Artifacts', 
        { group: vscode.TaskGroup.Clean }
    );
}

/**
 * Creates a {@link vscode.Task Task} to run an executable target.
 */
 function createBuildTask(product: Product): vscode.Task {
    return createSwiftTask(
        'swift', 
        ['build', '--product', product.name], 
        `Build ${product.name}`, 
        { group: vscode.TaskGroup.Build }
    );
}

/**
 * Creates a {@link vscode.Task Task} to resolve the package dependencies.
 */
function createResolveTask(): vscode.Task {
    return createSwiftTask('swift', ['package', 'resolve'], 'Resolve Package Dependencies');
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
function createSwiftTask(command: string, args: string[], name: string, config?: TaskConfig): vscode.Task {
    let task = new vscode.Task(
        { type: 'swift', command: command, args: args },
        config?.scope ?? vscode.TaskScope.Workspace,
        name,
        'swift',
        new vscode.ShellExecution(command, args),
        config?.problemMatcher
    );
    // This doesn't include any quotes added by VS Code.
    // See also: https://github.com/microsoft/vscode/issues/137895
    task.detail = `${command} ${args.join(' ')}`;
    task.group = config?.group;
    if (config?.presentationOptions !== undefined) {
        task.presentationOptions = config?.presentationOptions;
    }
    return task;
}

/*
 * Execute shell command as task and wait until it is finished
 */
export async function executeShellTaskAndWait(name: string, command: string, args: string[], config?: TaskConfig) {
    let task = new vscode.Task(
        { type: 'swift', command: command, args: args },
        config?.scope ?? vscode.TaskScope.Workspace,
        name,
        'swift',
        new vscode.ShellExecution(command, args),
        config?.problemMatcher
    );
    task.group = config?.group;
    if (config?.presentationOptions !== undefined) {
        task.presentationOptions = config?.presentationOptions;
    }
    executeTaskAndWait(task);
}

/*
 * Execute task and wait until it is finished. This function assumes that no
 * other tasks with the same name will be run at the same time
 */
export async function executeTaskAndWait(task: vscode.Task) {
    return new Promise<void>(resolve => {
        const disposable = vscode.tasks.onDidEndTask(({ execution }) => {
            if (execution.task.name === task.name) {
                disposable.dispose();
                resolve();
            }
        });
        vscode.tasks.executeTask(task);
    });    
} 

/**
 * A {@link vscode.TaskProvider TaskProvider} for tasks that match the definition
 * in **package.json**: `{ type: 'swift'; command: string; args: string[] }`.
 * 
 * See {@link SwiftTaskProvider.provideTasks provideTasks} for a list of provided tasks.
 */
export class SwiftTaskProvider implements vscode.TaskProvider {

    constructor(private workspaceContext: WorkspaceContext) { }

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
        if (this.workspaceContext.folders.length === 0) {
            return [];
        }
        let tasks = [
            createBuildAllTask(),
            createCleanTask(),
            createResolveTask(),
            createUpdateTask()
        ];

        for (const folder of this.workspaceContext.folders) {
            if (!folder.isRootFolder) { continue; }
            const executables = folder.swiftPackage.executableProducts;
            for (const executable of executables) {
                tasks.push(createBuildTask(executable));
            }
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
