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
import { Product } from "./SwiftPackage";
import configuration from "./configuration";
import { getSwiftExecutable } from "./utilities";

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
    scope?: vscode.TaskScope | vscode.WorkspaceFolder;
    group?: vscode.TaskGroup;
    problemMatcher?: string | string[];
    presentationOptions?: vscode.TaskPresentationOptions;
}

/**
 * Creates a {@link vscode.Task Task} to build all targets in this package.
 */
function createBuildAllTask(folder: vscode.WorkspaceFolder): vscode.Task {
    const additionalArgs: string[] = [];
    if (process.platform !== "darwin") {
        additionalArgs.push("--enable-test-discovery");
    }
    if (process.platform === "win32") {
        additionalArgs.push("-Xlinker", "-debug:dwarf");
    }
    return createSwiftTask(
        ["build", "--build-tests", ...additionalArgs, ...configuration.buildArguments],
        SwiftTaskProvider.buildAllName,
        { group: vscode.TaskGroup.Build, scope: folder }
    );
}

/**
 * Creates a {@link vscode.Task Task} to run an executable target.
 */
function createBuildTasks(product: Product, folder: vscode.WorkspaceFolder): vscode.Task[] {
    const debugArguments = process.platform === "win32" ? ["-Xlinker", "-debug:dwarf"] : [];
    return [
        createSwiftTask(
            [
                "build",
                "--product",
                product.name,
                ...debugArguments,
                ...configuration.buildArguments,
            ],
            `Build Debug ${product.name}`,
            { group: vscode.TaskGroup.Build, scope: folder }
        ),
        createSwiftTask(
            ["build", "-c", "release", "--product", product.name, ...configuration.buildArguments],
            `Build Release ${product.name}`,
            { group: vscode.TaskGroup.Build, scope: folder }
        ),
    ];
}

/**
 * Helper function to create a {@link vscode.Task Task} with the given parameters.
 */
export function createSwiftTask(args: string[], name: string, config?: TaskConfig): vscode.Task {
    const swift = getSwiftExecutable();
    const task = new vscode.Task(
        { type: "swift", command: swift, args: args },
        config?.scope ?? vscode.TaskScope.Workspace,
        name,
        "swift",
        new vscode.ShellExecution(swift, args),
        config?.problemMatcher
    );
    // This doesn't include any quotes added by VS Code.
    // See also: https://github.com/microsoft/vscode/issues/137895
    task.detail = `swift ${args.join(" ")}`;
    task.group = config?.group;
    task.presentationOptions = config?.presentationOptions ?? {};
    return task;
}

/*
 * Execute swift command as task and wait until it is finished
 */
export async function executeSwiftTaskAndWait(args: string[], name: string, config?: TaskConfig) {
    const swift = getSwiftExecutable();
    const task = new vscode.Task(
        { type: "swift", command: "swift", args: args },
        config?.scope ?? vscode.TaskScope.Workspace,
        name,
        "swift",
        new vscode.ShellExecution(swift, args),
        config?.problemMatcher
    );
    task.group = config?.group;
    task.presentationOptions = config?.presentationOptions ?? {};

    executeTaskAndWait(task);
}

/*
 * Execute shell command as task and wait until it is finished
 */
export async function executeShellTaskAndWait(
    command: string,
    args: string[],
    name: string,
    config?: TaskConfig
) {
    const task = new vscode.Task(
        { type: "swift", command: command, args: args },
        config?.scope ?? vscode.TaskScope.Workspace,
        name,
        "swift",
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
            if (execution.task.name === task.name && execution.task.scope === task.scope) {
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
    static buildAllName = "Build All";
    static cleanBuildName = "Clean Build Artifacts";
    static resolvePackageName = "Resolve Package Dependencies";
    static updatePackageName = "Update Package Dependencies";

    constructor(private workspaceContext: WorkspaceContext) {}

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
        const tasks = [];

        for (const folderContext of this.workspaceContext.folders) {
            if (!folderContext.swiftPackage.foundPackage) {
                continue;
            }
            tasks.push(createBuildAllTask(folderContext.folder));
            const executables = folderContext.swiftPackage.executableProducts;
            for (const executable of executables) {
                tasks.push(...createBuildTasks(executable, folderContext.folder));
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
            task.name || "Custom Task",
            "swift",
            new vscode.ShellExecution(task.definition.command, task.definition.args),
            task.problemMatchers
        );
        newTask.detail =
            task.detail ?? `${task.definition.command} ${task.definition.args.join(" ")}`;
        newTask.group = task.group;
        newTask.presentationOptions = task.presentationOptions;

        return newTask;
    }
}
