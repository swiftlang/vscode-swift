//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2022 the VSCode Swift project authors
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
import { WorkspaceContext } from "./WorkspaceContext";
import { FolderContext } from "./FolderContext";
import { Product } from "./SwiftPackage";
import configuration from "./configuration";
import { swiftRuntimeEnv } from "./utilities/utilities";
import { Version } from "./utilities/version";
import { SwiftToolchain } from "./toolchain/toolchain";

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
    cwd: vscode.Uri;
    scope: vscode.TaskScope | vscode.WorkspaceFolder;
    group?: vscode.TaskGroup;
    problemMatcher?: string | string[];
    presentationOptions?: vscode.TaskPresentationOptions;
    prefix?: string;
    disableTaskQueue?: boolean;
    dontTriggerTestDiscovery?: boolean;
}

interface TaskPlatformSpecificConfig {
    args?: string[];
    cwd?: string;
    env?: { [name: string]: unknown };
}

/** flag for enabling test discovery */
function testDiscoveryFlag(ctx: FolderContext): string[] {
    // Test discovery is only available in SwiftPM 5.1 and later.
    if (ctx.workspaceContext.swiftVersion.isLessThan(new Version(5, 1, 0))) {
        return [];
    }
    // Test discovery is always enabled on Darwin.
    if (process.platform !== "darwin") {
        const hasLinuxMain = ctx.linuxMain.exists;
        const testDiscoveryByDefault = ctx.workspaceContext.swiftVersion.isGreaterThanOrEqual(
            new Version(5, 4, 0)
        );
        if (hasLinuxMain || !testDiscoveryByDefault) {
            return ["--enable-test-discovery"];
        }
    }
    return [];
}

/** arguments for generating debug builds */
export function platformDebugBuildOptions(toolchain: SwiftToolchain): string[] {
    if (process.platform === "win32") {
        if (toolchain.swiftVersion.isGreaterThanOrEqual(new Version(5, 9, 0))) {
            return ["-Xlinker", "-debug:dwarf"];
        } else {
            return ["-Xswiftc", "-g", "-Xswiftc", "-use-ld=lld", "-Xlinker", "-debug:dwarf"];
        }
    }
    return [];
}

/** Return swift build options */
export function buildOptions(toolchain: SwiftToolchain, debug = true): string[] {
    const args: string[] = [];
    if (debug) {
        args.push(...platformDebugBuildOptions(toolchain));
    }
    const sanitizer = toolchain.sanitizer(configuration.sanitizer);
    if (sanitizer) {
        args.push(...sanitizer.buildFlags);
    }
    args.push(...configuration.buildArguments);
    return args;
}

/**
 * Get task reveal kind based off configuration
 */
function getBuildRevealOption(): vscode.TaskRevealKind {
    return configuration.actionAfterBuildError === "Focus Terminal"
        ? vscode.TaskRevealKind.Silent
        : vscode.TaskRevealKind.Never;
}

/**
 * Creates a {@link vscode.Task Task} to build all targets in this package.
 */
export function createBuildAllTask(folderContext: FolderContext): vscode.Task {
    let additionalArgs = buildOptions(folderContext.workspaceContext.toolchain);
    if (folderContext.swiftPackage.getTargets("test").length > 0) {
        additionalArgs.push(...testDiscoveryFlag(folderContext));
    }
    let buildTaskName = SwiftTaskProvider.buildAllName;
    if (folderContext.relativePath.length > 0) {
        buildTaskName += ` (${folderContext.relativePath})`;
    }
    // don't build tests for iOS etc as they don't compile
    if (folderContext.workspaceContext.toolchain.buildFlags.getDarwinTarget() === undefined) {
        additionalArgs = ["--build-tests", ...additionalArgs];
    }
    return createSwiftTask(
        ["build", ...additionalArgs],
        buildTaskName,
        {
            group: vscode.TaskGroup.Build,
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            presentationOptions: {
                reveal: getBuildRevealOption(),
            },
            problemMatcher: configuration.problemMatchCompileErrors ? "$swiftc" : undefined,
            disableTaskQueue: true,
        },
        folderContext.workspaceContext.toolchain
    );
}

/**
 * Return build all task for a folder
 * @param folderContext Folder to get Build All Task for
 * @returns Build All Task
 */
export async function getBuildAllTask(folderContext: FolderContext): Promise<vscode.Task> {
    let buildTaskName = SwiftTaskProvider.buildAllName;
    if (folderContext.relativePath.length > 0) {
        buildTaskName += ` (${folderContext.relativePath})`;
    }

    const folderWorkingDir = folderContext.workspaceFolder.uri.fsPath;
    // search for build all task in task.json first, that are valid for folder
    const workspaceTasks = (await vscode.tasks.fetchTasks()).filter(task => {
        if (task.source !== "Workspace" || task.scope !== folderContext.workspaceFolder) {
            return false;
        }
        const processExecutionOptions = (task.execution as vscode.ProcessExecution).options;
        const shellExecutionOptions = (task.execution as vscode.ShellExecution).options;
        let cwd = processExecutionOptions?.cwd ?? shellExecutionOptions?.cwd;
        if (cwd === "${workspaceFolder}" || cwd === undefined) {
            cwd = folderWorkingDir;
        }
        return cwd === folderContext.folder.fsPath;
    });

    // find default build task
    let task = workspaceTasks.find(
        task => task.group?.id === vscode.TaskGroup.Build.id && task.group?.isDefault === true
    );
    if (task) {
        return task;
    }
    // find task with name "swift: Build All"
    task = workspaceTasks.find(task => task.name === `swift: ${buildTaskName}`);
    if (task) {
        return task;
    }
    // search for generated tasks
    const swiftTasks = await vscode.tasks.fetchTasks({ type: "swift" });
    task = swiftTasks.find(
        task =>
            task.name === buildTaskName &&
            (task.execution as vscode.ProcessExecution).options?.cwd ===
                folderContext.folder.fsPath &&
            task.source === "swift"
    );
    if (!task) {
        throw Error("Build All Task does not exist");
    }
    return task;
}

/**
 * Creates a {@link vscode.Task Task} to run an executable target.
 */
function createBuildTasks(product: Product, folderContext: FolderContext): vscode.Task[] {
    const toolchain = folderContext.workspaceContext.toolchain;
    let buildTaskNameSuffix = "";
    if (folderContext.relativePath.length > 0) {
        buildTaskNameSuffix = ` (${folderContext.relativePath})`;
    }
    return [
        createSwiftTask(
            ["build", "--product", product.name, ...buildOptions(toolchain)],
            `Build Debug ${product.name}${buildTaskNameSuffix}`,
            {
                group: vscode.TaskGroup.Build,
                cwd: folderContext.folder,
                scope: folderContext.workspaceFolder,
                presentationOptions: {
                    reveal: getBuildRevealOption(),
                },
                problemMatcher: configuration.problemMatchCompileErrors ? "$swiftc" : undefined,
                disableTaskQueue: true,
                dontTriggerTestDiscovery: true,
            },
            folderContext.workspaceContext.toolchain
        ),
        createSwiftTask(
            ["build", "-c", "release", "--product", product.name, ...configuration.buildArguments],
            `Build Release ${product.name}${buildTaskNameSuffix}`,
            {
                group: vscode.TaskGroup.Build,
                cwd: folderContext.folder,
                scope: folderContext.workspaceFolder,
                presentationOptions: {
                    reveal: getBuildRevealOption(),
                },
                problemMatcher: configuration.problemMatchCompileErrors ? "$swiftc" : undefined,
                disableTaskQueue: true,
                dontTriggerTestDiscovery: true,
            },
            folderContext.workspaceContext.toolchain
        ),
    ];
}

/**
 * Helper function to create a {@link vscode.Task Task} with the given parameters.
 */
export function createSwiftTask(
    args: string[],
    name: string,
    config: TaskConfig,
    toolchain: SwiftToolchain
): vscode.Task {
    const swift = toolchain.getToolchainExecutable("swift");
    args = toolchain.buildFlags.withSwiftSDKFlags(args);

    // Add relative path current working directory
    const cwd = config.cwd.fsPath;
    const fullCwd = config.cwd.fsPath;

    /* Currently there seems to be a bug in vscode where kicking off two tasks
     with the same definition but different scopes messes with the task 
     completion code. When that is resolved we will go back to the code below
     where we only store the relative cwd instead of the full cwd

    const scopeWorkspaceFolder = config.scope as vscode.WorkspaceFolder;
    if (scopeWorkspaceFolder.uri.fsPath) {
        cwd = path.relative(scopeWorkspaceFolder.uri.fsPath, config.cwd.fsPath);
    } else {
        cwd = config.cwd.fsPath;
    }*/
    const env = { ...configuration.swiftEnvironmentVariables, ...swiftRuntimeEnv() };
    const task = new vscode.Task(
        {
            type: "swift",
            args: args,
            env: env,
            cwd: cwd,
            disableTaskQueue: config.disableTaskQueue,
            dontTriggerTestDiscovery: config.dontTriggerTestDiscovery,
        },
        config?.scope ?? vscode.TaskScope.Workspace,
        name,
        "swift",
        new vscode.ProcessExecution(swift, args, {
            cwd: fullCwd,
            env: env,
        }),
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
 * A {@link vscode.TaskProvider TaskProvider} for tasks that match the definition
 * in **package.json**: `{ type: 'swift'; args: string[], cwd: string? }`.
 *
 * See {@link SwiftTaskProvider.provideTasks provideTasks} for a list of provided tasks.
 */
export class SwiftTaskProvider implements vscode.TaskProvider {
    static buildAllName = "Build All";
    static cleanBuildName = "Clean Build";
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
            const activeOperation = folderContext.taskQueue.activeOperation;
            // if there is an active task running on the folder task queue (eg resolve or update)
            // then don't add build tasks for this folder instead create a dummy task indicating why
            // the build tasks are unavailable
            //
            // Ignore an active build task, it could be the build task that has just been
            // initiated.
            if (activeOperation && !activeOperation.operation.isBuildOperation) {
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: [],
                    },
                    folderContext.workspaceFolder,
                    `Build tasks disabled`,
                    "swift",
                    new vscode.CustomExecution(() => {
                        throw Error("Task disabled.");
                    })
                );
                task.group = vscode.TaskGroup.Build;
                task.detail = `While ${activeOperation.operation.name} is running.`;
                task.presentationOptions = { reveal: vscode.TaskRevealKind.Never, echo: false };
                tasks.push(task);
                continue;
            }

            tasks.push(createBuildAllTask(folderContext));
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
        const swift = this.workspaceContext.toolchain.getToolchainExecutable("swift");
        const scopeWorkspaceFolder = task.scope as vscode.WorkspaceFolder;
        // platform specific
        let platform: TaskPlatformSpecificConfig | undefined;
        if (process.platform === "win32") {
            platform = task.definition.windows;
        } else if (process.platform === "linux") {
            platform = task.definition.linux;
        } else if (process.platform === "darwin") {
            platform = task.definition.macos;
        }
        // get args and cwd values from either platform specific block or base
        const args = platform?.args ?? task.definition.args;
        const env = platform?.env ?? task.definition.env;
        let fullCwd = platform?.cwd ?? task.definition.cwd;
        if (fullCwd && !path.isAbsolute(fullCwd) && scopeWorkspaceFolder.uri.fsPath) {
            fullCwd = path.join(scopeWorkspaceFolder.uri.fsPath, fullCwd);
        }

        const newTask = new vscode.Task(
            task.definition,
            task.scope ?? vscode.TaskScope.Workspace,
            task.name ?? "Swift Custom Task",
            "swift",
            new vscode.ProcessExecution(swift, args, {
                cwd: fullCwd,
                env: { ...env, ...swiftRuntimeEnv() },
            }),
            task.problemMatchers
        );
        newTask.detail = task.detail ?? `swift ${args.join(" ")}`;
        newTask.group = task.group;
        newTask.presentationOptions = task.presentationOptions;

        return newTask;
    }
}
