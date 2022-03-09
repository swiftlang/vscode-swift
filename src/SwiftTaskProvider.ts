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
import { FolderContext } from "./FolderContext";
import { Product } from "./SwiftPackage";
import configuration from "./configuration";
import { getSwiftExecutable } from "./utilities/utilities";
import { Version } from "./utilities/version";

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
    cwd?: vscode.Uri;
    scope?: vscode.TaskScope | vscode.WorkspaceFolder;
    group?: vscode.TaskGroup;
    problemMatcher?: string | string[];
    presentationOptions?: vscode.TaskPresentationOptions;
    prefix?: string;
}

/** flag for enabling test discovery */
async function testDiscoveryFlag(ctx: FolderContext): Promise<string[]> {
    // Test discovery is only available in SwiftPM 5.1 and later.
    if (ctx.workspaceContext.swiftVersion.isLessThan(new Version(5, 1, 0))) {
        return [];
    }
    // Test discovery is always enabled on Darwin.
    if (process.platform !== "darwin") {
        const alwaysDiscoverTests = vscode.workspace
            .getConfiguration("swiftpm")
            .get<boolean>("testDiscovery.always", true);
        const hasLinuxMain = await ctx.hasLinuxMain;
        const testDiscoveryByDefault = ctx.workspaceContext.swiftVersion.isGreaterThanOrEqual(
            new Version(5, 4, 0)
        );
        if ((hasLinuxMain && alwaysDiscoverTests) || (!hasLinuxMain && !testDiscoveryByDefault)) {
            return ["--enable-test-discovery"];
        }
    }
    return [];
}

/** arguments for generating windows debug builds */
function win32BuildOptions(): string[] {
    return ["-Xswiftc", "-g", "-Xswiftc", "-use-ld=lld", "-Xlinker", "-debug:dwarf"];
}

/**
 * Creates a {@link vscode.Task Task} to build all targets in this package.
 */
async function createBuildAllTask(folderContext: FolderContext): Promise<vscode.Task> {
    const additionalArgs: string[] = [];
    if (folderContext.swiftPackage.getTargets("test").length > 0) {
        additionalArgs.push(...(await testDiscoveryFlag(folderContext)));
    }
    if (process.platform === "win32") {
        additionalArgs.push(...win32BuildOptions());
    }
    let buildTaskName = SwiftTaskProvider.buildAllName;
    if (folderContext.relativePath.length > 0) {
        buildTaskName += ` (${folderContext.relativePath})`;
    }
    return createSwiftTask(
        ["build", "--build-tests", ...additionalArgs, ...configuration.buildArguments],
        buildTaskName,
        {
            group: vscode.TaskGroup.Build,
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            presentationOptions: { clear: true },
        }
    );
}

/**
 * Creates a {@link vscode.Task Task} to run an executable target.
 */
function createBuildTasks(product: Product, folderContext: FolderContext): vscode.Task[] {
    const debugArguments = process.platform === "win32" ? win32BuildOptions() : [];
    let buildTaskNameSuffix = "";
    if (folderContext.relativePath.length > 0) {
        buildTaskNameSuffix = ` (${folderContext.relativePath})`;
    }
    return [
        createSwiftTask(
            [
                "build",
                "--product",
                product.name,
                ...debugArguments,
                ...configuration.buildArguments,
            ],
            `Build Debug ${product.name}${buildTaskNameSuffix}`,
            {
                group: vscode.TaskGroup.Build,
                cwd: folderContext.folder,
                scope: folderContext.workspaceFolder,
                presentationOptions: { clear: true },
            }
        ),
        createSwiftTask(
            ["build", "-c", "release", "--product", product.name, ...configuration.buildArguments],
            `Build Release ${product.name}${buildTaskNameSuffix}`,
            {
                group: vscode.TaskGroup.Build,
                cwd: folderContext.folder,
                scope: folderContext.workspaceFolder,
                presentationOptions: { clear: true },
            }
        ),
    ];
}

/**
 * Helper function to create a {@link vscode.Task Task} with the given parameters.
 */
export function createSwiftTask(args: string[], name: string, config?: TaskConfig): vscode.Task {
    const swift = getSwiftExecutable();
    const task = new vscode.Task(
        { type: "swift", command: swift, args: args, cwd: config?.cwd?.fsPath },
        config?.scope ?? vscode.TaskScope.Workspace,
        name,
        "swift",
        new vscode.ShellExecution(swift, args, { cwd: config?.cwd?.fsPath }),
        config?.problemMatcher
    );
    // This doesn't include any quotes added by VS Code.
    // See also: https://github.com/microsoft/vscode/issues/137895

    let prefix: string;
    if (config?.prefix) {
        prefix = `(${config.prefix}) `;
    } else {
        prefix = "";
    }
    task.detail = `${prefix}swift ${args.join(" ")}`;
    task.group = config?.group;
    task.presentationOptions = config?.presentationOptions ?? {};
    return task;
}

/**
 * Execute task and wait until it is finished. This function assumes that no
 * other tasks with the same name will be run at the same time
 *
 * @param task task to execute
 * @returns exit code from executable
 */
export async function executeTaskAndWait(task: vscode.Task): Promise<number | undefined> {
    return new Promise<number | undefined>(resolve => {
        const disposable = vscode.tasks.onDidEndTaskProcess(event => {
            if (event.execution.task.definition === task.definition) {
                disposable.dispose();
                resolve(event.exitCode);
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
            tasks.push(await createBuildAllTask(folderContext));
            const executables = folderContext.swiftPackage.executableProducts;
            for (const executable of executables) {
                tasks.push(...createBuildTasks(executable, folderContext));
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
            task.name ?? "Custom Task",
            "swift",
            new vscode.ShellExecution(task.definition.command, task.definition.args, {
                cwd: task.definition.cwd,
            }),
            task.problemMatchers
        );
        newTask.detail =
            task.detail ?? `${task.definition.command} ${task.definition.args.join(" ")}`;
        newTask.group = task.group;
        newTask.presentationOptions = task.presentationOptions;

        return newTask;
    }
}
