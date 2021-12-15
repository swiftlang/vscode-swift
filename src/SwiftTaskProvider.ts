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
function createBuildAllTask(workspaceContext: WorkspaceContext): vscode.Task {
    const additionalArgs = (process.platform !== 'darwin') ? ['--enable-test-discovery'] : [];
    return createSwiftTask(
        workspaceContext.swiftExe, 
        ['build', '--build-tests', ...additionalArgs, ...workspaceContext.config.get<string[]>('buildArguments', [])], 
        'Build All', 
        { group: vscode.TaskGroup.Build }
    );
}

/**
 * Creates a {@link vscode.Task Task} to clean the build artifacts.
 */
function createCleanTask(workspaceContext: WorkspaceContext): vscode.Task {
    return createSwiftTask(
        workspaceContext.swiftExe, 
        ['package', 'clean'], 
        'Clean Build Artifacts', 
        { group: vscode.TaskGroup.Clean }
    );
}

/**
 * Creates a {@link vscode.Task Task} to run an executable target.
 */
 function createBuildTasks(product: Product,  workspaceContext: WorkspaceContext): vscode.Task[] {
    return [
        createSwiftTask(
            workspaceContext.swiftExe, 
            ['build', '--product', product.name, ...workspaceContext.config.get<string[]>('buildArguments', [])], 
            `Build Debug ${product.name}`, 
            { group: vscode.TaskGroup.Build }
        ),
        createSwiftTask(
            workspaceContext.swiftExe, 
            ['build', '-c', 'release', '--product', product.name, ...workspaceContext.config.get<string[]>('buildArguments', [])], 
            `Build Release ${product.name}`, 
            { group: vscode.TaskGroup.Build }
        )
    ];
}

/**
 * Creates a {@link vscode.Task Task} to resolve the package dependencies.
 */
function createResolveTask(workspaceContext: WorkspaceContext): vscode.Task {
    return createSwiftTask(workspaceContext.swiftExe, ['package', 'resolve'], 'Resolve Package Dependencies');
}

/**
 * Creates a {@link vscode.Task Task} to update the package dependencies.
 */
function createUpdateTask(workspaceContext: WorkspaceContext): vscode.Task {
    return createSwiftTask(workspaceContext.swiftExe, ['package', 'update'], 'Update Package Dependencies');
}

/**
 * Helper function to create a {@link vscode.Task Task} with the given parameters.
 */
function createSwiftTask(command: string, args: string[], name: string, config?: TaskConfig): vscode.Task {
    const task = new vscode.Task(
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
    task.presentationOptions = config?.presentationOptions ?? {};
    return task;
}

/*
 * Execute shell command as task and wait until it is finished
 */
export async function executeShellTaskAndWait(name: string, command: string, args: string[], config?: TaskConfig) {
    const task = new vscode.Task(
        { type: 'swift', command: command, args: args },
        config?.scope ?? vscode.TaskScope.Workspace,
        name,
        'swift',
        new vscode.ShellExecution(command, args),
        config?.problemMatcher
    );
    task.group = config?.group;
    task.presentationOptions = config?.presentationOptions ?? {};

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async provideTasks(token: vscode.CancellationToken): Promise<vscode.Task[]> {
        if (this.workspaceContext.folders.length === 0) {
            return [];
        }
        const tasks = [
            createBuildAllTask(this.workspaceContext),
            createCleanTask(this.workspaceContext),
            createResolveTask(this.workspaceContext),
            createUpdateTask(this.workspaceContext)
        ];

        for (const folder of this.workspaceContext.folders) {
            if (!folder.isRootFolder) { continue; }
            const executables = folder.swiftPackage.executableProducts;
            for (const executable of executables) {
                tasks.push(...createBuildTasks(executable, this.workspaceContext));
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    resolveTask(task: vscode.Task, token: vscode.CancellationToken): vscode.Task {
        // We need to create a new Task object here.
        // Reusing the task parameter doesn't seem to work.
        const newTask = new vscode.Task(
            task.definition,
            task.scope ?? vscode.TaskScope.Workspace,
            task.name || 'Custom Task',
            'swift',
            new vscode.ShellExecution(task.definition.command, task.definition.args),
            task.problemMatchers
        );
        newTask.detail = task.detail ?? `${task.definition.command} ${task.definition.args.join(' ')}`;
        newTask.group = task.group;
        newTask.presentationOptions = task.presentationOptions;

        return newTask;
    }
}
