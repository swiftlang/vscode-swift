//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { WorkspaceContext } from "../WorkspaceContext";
import { FolderContext } from "../FolderContext";
import { Product } from "../SwiftPackage";
import configuration, { ShowBuildStatusOptions } from "../configuration";
import { swiftRuntimeEnv } from "../utilities/utilities";
import { Version } from "../utilities/version";
import { SwiftToolchain } from "../toolchain/toolchain";
import { SwiftExecution } from "../tasks/SwiftExecution";
import { resolveTaskCwd } from "../utilities/tasks";
import { BuildConfigurationFactory } from "../debugger/buildConfig";

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
    presentationOptions?: vscode.TaskPresentationOptions;
    prefix?: string;
    disableTaskQueue?: boolean;
    dontTriggerTestDiscovery?: boolean;
    showBuildStatus?: ShowBuildStatusOptions;
}

interface TaskPlatformSpecificConfig {
    args?: string[];
    cwd?: string;
    env?: { [name: string]: unknown };
}

export interface SwiftTask extends vscode.Task {
    execution: SwiftExecution;
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

/** arguments for setting diagnostics style */
export function diagnosticsStyleOptions(): string[] {
    if (configuration.diagnosticsStyle !== "default") {
        return ["-Xswiftc", `-diagnostic-style=${configuration.diagnosticsStyle}`];
    }
    return [];
}

/** Return swift build options */
export function buildOptions(toolchain: SwiftToolchain, debug = true): string[] {
    const args: string[] = [];
    if (debug) {
        args.push(...platformDebugBuildOptions(toolchain));
    }
    args.push(...diagnosticsStyleOptions());
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

const buildAllTaskCache = (() => {
    const cache = new Map<string, SwiftTask>();
    const key = (name: string, folderContext: FolderContext, task: SwiftTask) => {
        return `${name}:${folderContext.folder}:${buildOptions(folderContext.workspaceContext.toolchain).join(",")}:${task.definition.args.join(",")}`;
    };

    return {
        get(name: string, folderContext: FolderContext, task: SwiftTask): SwiftTask {
            const cached = cache.get(key(name, folderContext, task));
            if (!cached) {
                this.set(name, folderContext, task);
            }
            return cached ?? task;
        },
        set(name: string, folderContext: FolderContext, task: SwiftTask) {
            cache.set(key(name, folderContext, task), task);
        },
    };
})();

function buildAllTaskName(folderContext: FolderContext, release: boolean): string {
    let buildTaskName = release
        ? `${SwiftTaskProvider.buildAllName} - Release`
        : SwiftTaskProvider.buildAllName;
    if (folderContext.relativePath.length > 0) {
        buildTaskName += ` (${folderContext.relativePath})`;
    }
    return buildTaskName;
}

/**
 * Creates a {@link vscode.Task Task} to build all targets in this package.
 */
export function createBuildAllTask(
    folderContext: FolderContext,
    release: boolean = false
): SwiftTask {
    const args = BuildConfigurationFactory.buildAll(folderContext, false, release).args;
    const buildTaskName = buildAllTaskName(folderContext, release);
    const task = createSwiftTask(
        args,
        buildTaskName,
        {
            group: vscode.TaskGroup.Build,
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            presentationOptions: {
                reveal: getBuildRevealOption(),
            },
            disableTaskQueue: true,
        },
        folderContext.workspaceContext.toolchain
    );

    // Ensures there is one Build All task per folder context, since this can be called multiple
    // times and we want the same instance each time. Otherwise, VS Code may try and execute
    // one instance while our extension code tries to listen to events on an instance created earlier/later.
    return buildAllTaskCache.get(buildTaskName, folderContext, task);
}

/**
 * Return build all task for a folder
 * @param folderContext Folder to get Build All Task for
 * @returns Build All Task
 */
export async function getBuildAllTask(
    folderContext: FolderContext,
    release: boolean = false
): Promise<vscode.Task> {
    const buildTaskName = buildAllTaskName(folderContext, release);
    const folderWorkingDir = folderContext.workspaceFolder.uri.fsPath;
    // search for build all task in task.json first, that are valid for folder
    const workspaceTasks = (await vscode.tasks.fetchTasks()).filter(task => {
        if (task.source !== "Workspace" || task.scope !== folderContext.workspaceFolder) {
            return false;
        }
        const swiftExecutionOptions = (task.execution as SwiftExecution).options;
        let cwd = swiftExecutionOptions?.cwd;
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
            (task.execution as SwiftExecution).options?.cwd === folderContext.folder.fsPath &&
            task.source === "swift"
    );
    if (!task) {
        task = createBuildAllTask(folderContext, release);
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

    const buildDebugName = `Build Debug ${product.name}${buildTaskNameSuffix}`;
    const buildDebugTask = createSwiftTask(
        ["build", "--product", product.name, ...buildOptions(toolchain)],
        buildDebugName,
        {
            group: vscode.TaskGroup.Build,
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            presentationOptions: {
                reveal: getBuildRevealOption(),
            },
            disableTaskQueue: true,
            dontTriggerTestDiscovery: true,
        },
        folderContext.workspaceContext.toolchain
    );
    const buildDebug = buildAllTaskCache.get(buildDebugName, folderContext, buildDebugTask);

    const buildReleaseName = `Build Release ${product.name}${buildTaskNameSuffix}`;
    const buildReleaseTask = createSwiftTask(
        ["build", "-c", "release", "--product", product.name, ...buildOptions(toolchain, false)],
        `Build Release ${product.name}${buildTaskNameSuffix}`,
        {
            group: vscode.TaskGroup.Build,
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            presentationOptions: {
                reveal: getBuildRevealOption(),
            },
            disableTaskQueue: true,
            dontTriggerTestDiscovery: true,
        },
        folderContext.workspaceContext.toolchain
    );
    const buildRelease = buildAllTaskCache.get(buildReleaseName, folderContext, buildReleaseTask);
    return [buildDebug, buildRelease];
}

/**
 * Helper function to create a {@link vscode.Task Task} with the given parameters.
 */
export function createSwiftTask(
    args: string[],
    name: string,
    config: TaskConfig,
    toolchain: SwiftToolchain,
    cmdEnv: { [key: string]: string } = {}
): SwiftTask {
    const swift = toolchain.getToolchainExecutable("swift");
    args = toolchain.buildFlags.withAdditionalFlags(args);

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
    const env = { ...configuration.swiftEnvironmentVariables, ...swiftRuntimeEnv(), ...cmdEnv };
    const presentation = config?.presentationOptions ?? {};
    const task = new vscode.Task(
        {
            type: "swift",
            args: args,
            env: env,
            cwd: cwd,
            ...(config.showBuildStatus !== undefined
                ? { showBuildStatus: config.showBuildStatus }
                : {}),
            ...(config.disableTaskQueue !== undefined
                ? { disableTaskQueue: config.disableTaskQueue }
                : {}),
            ...(config.dontTriggerTestDiscovery !== undefined
                ? { dontTriggerTestDiscovery: config.dontTriggerTestDiscovery }
                : {}),
        },
        config?.scope ?? vscode.TaskScope.Workspace,
        name,
        "swift",
        new SwiftExecution(swift, args, {
            cwd: fullCwd,
            env: env,
            presentation,
        })
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
    task.presentationOptions = presentation;
    return task as SwiftTask;
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
            //
            // This is only required in Swift toolchains before v6 as SwiftPM in newer toolchains
            // will block multiple processes accessing the .build folder at the same time
            if (
                this.workspaceContext.toolchain.swiftVersion.isLessThan(new Version(6, 0, 0)) &&
                activeOperation &&
                !activeOperation.operation.isBuildOperation
            ) {
                let buildTaskName = "Build tasks disabled";
                if (folderContext.relativePath.length > 0) {
                    buildTaskName += ` (${folderContext.relativePath})`;
                }
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: [],
                    },
                    folderContext.workspaceFolder,
                    buildTaskName,
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

            // Create debug Build All task.
            tasks.push(createBuildAllTask(folderContext, false));

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
        const toolchain = this.workspaceContext.toolchain;
        const swift = toolchain.getToolchainExecutable("swift");
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
        const fullCwd = resolveTaskCwd(task, platform?.cwd ?? task.definition.cwd);

        const presentation = task.definition.presentation ?? task.presentationOptions ?? {};
        const newTask = new vscode.Task(
            task.definition,
            task.scope ?? vscode.TaskScope.Workspace,
            task.name ?? "Swift Custom Task",
            "swift",
            new SwiftExecution(swift, args, {
                cwd: fullCwd,
                env: { ...env, ...swiftRuntimeEnv() },
                presentation,
            }),
            task.problemMatchers
        );
        newTask.detail = task.detail ?? `swift ${args.join(" ")}`;
        newTask.group = task.group;
        newTask.presentationOptions = presentation;

        return newTask;
    }
}
