//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2022 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as path from "path";
import { WorkspaceContext } from "../WorkspaceContext";
import { PackagePlugin } from "../SwiftPackage";
import { swiftRuntimeEnv } from "../utilities/utilities";
import { SwiftExecution } from "../tasks/SwiftExecution";
import { resolveTaskCwd } from "../utilities/tasks";
import configuration, { PluginPermissionConfiguration } from "../configuration";
import { SwiftTask } from "./SwiftTaskProvider";

// Interface class for defining task configuration
interface TaskConfig {
    cwd: vscode.Uri;
    scope: vscode.WorkspaceFolder;
    presentationOptions?: vscode.TaskPresentationOptions;
    prefix?: string;
}

/**
 * A {@link vscode.TaskProvider TaskProvider} for tasks that match the definition
 * in **package.json**: `{ type: 'swift'; command: string; args: string[] }`.
 *
 * See {@link SwiftTaskProvider.provideTasks provideTasks} for a list of provided tasks.
 */
export class SwiftPluginTaskProvider implements vscode.TaskProvider {
    constructor(private workspaceContext: WorkspaceContext) {}

    /**
     * Provides tasks to run swift plugins:
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async provideTasks(token: vscode.CancellationToken): Promise<vscode.Task[]> {
        if (this.workspaceContext.folders.length === 0) {
            return [];
        }
        const tasks = [];

        for (const folderContext of this.workspaceContext.folders) {
            for (const plugin of folderContext.swiftPackage.plugins) {
                tasks.push(
                    this.createSwiftPluginTask(plugin, {
                        cwd: folderContext.folder,
                        scope: folderContext.workspaceFolder,
                        presentationOptions: {
                            reveal: vscode.TaskRevealKind.Always,
                        },
                    })
                );
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
        let swiftArgs = ["package", task.definition.command, ...task.definition.args];
        swiftArgs = this.workspaceContext.toolchain.buildFlags.withSwiftSDKFlags(swiftArgs);

        const cwd = resolveTaskCwd(task, task.definition.cwd);
        const newTask = new vscode.Task(
            task.definition,
            task.scope ?? vscode.TaskScope.Workspace,
            task.name,
            "swift-plugin",
            new SwiftExecution(swift, swiftArgs, {
                cwd,
                presentation: task.presentationOptions,
            }),
            task.problemMatchers
        );
        newTask.detail = task.detail ?? `swift ${swiftArgs.join(" ")}`;
        newTask.presentationOptions = task.presentationOptions;

        return newTask;
    }

    /**
     *
     * @param plugin Helper function to create a swift plugin task
     * @param args arguments sent to plugin
     * @param config
     * @returns
     */
    createSwiftPluginTask(plugin: PackagePlugin, config: TaskConfig): SwiftTask {
        const swift = this.workspaceContext.toolchain.getToolchainExecutable("swift");

        // Add relative path current working directory
        const relativeCwd = path.relative(config.scope.uri.fsPath, config.cwd.fsPath);
        const taskDefinitionCwd = relativeCwd !== "" ? relativeCwd : undefined;
        const definition = this.getTaskDefinition(plugin, taskDefinitionCwd);
        let swiftArgs = [
            "package",
            ...this.pluginArgumentsFromConfiguration(config.scope, definition, plugin),
            plugin.command,
            ...definition.args,
        ];
        swiftArgs = this.workspaceContext.toolchain.buildFlags.withSwiftSDKFlags(swiftArgs);

        const presentation = config?.presentationOptions ?? {};
        const task = new vscode.Task(
            definition,
            config.scope ?? vscode.TaskScope.Workspace,
            plugin.name,
            "swift-plugin",
            new SwiftExecution(swift, swiftArgs, {
                cwd: config.cwd.fsPath,
                env: { ...configuration.swiftEnvironmentVariables, ...swiftRuntimeEnv() },
                presentation,
            }),
            []
        );
        let prefix: string;
        if (config.prefix) {
            prefix = `(${config.prefix}) `;
        } else {
            prefix = "";
        }
        task.detail = `${prefix}swift ${swiftArgs.join(" ")}`;
        task.presentationOptions = presentation;
        return task as SwiftTask;
    }

    /**
     * Get task definition for a command plugin
     */
    private getTaskDefinition(
        plugin: PackagePlugin,
        cwd: string | undefined
    ): vscode.TaskDefinition {
        const definition = {
            type: "swift-plugin",
            command: plugin.command,
            args: [],
            disableSandbox: false,
            allowWritingToPackageDirectory: false,
            cwd,
            disableTaskQueue: false,
        };
        // There are common command plugins used across the package eco-system eg for docc generation
        // Everytime these are run they need the same default setup.
        switch (`${plugin.package}, ${plugin.command}`) {
            case "swift-aws-lambda-runtime, archive":
                definition.disableSandbox = true;
                definition.disableTaskQueue = true;
                break;

            case "SwiftDocCPlugin, generate-documentation":
                definition.allowWritingToPackageDirectory = true;
                break;

            case "SwiftDocCPlugin, preview-documentation":
                definition.disableSandbox = true;
                definition.allowWritingToPackageDirectory = true;
                break;

            case "SwiftFormat, swiftformat":
                definition.allowWritingToPackageDirectory = true;
                break;

            case "swift-format, format-source-code":
                definition.allowWritingToPackageDirectory = true;
                break;

            default:
                break;
        }
        return definition;
    }

    /**
     * Generates a list of permission related plugin arguments from two sources,
     * the hardcoded list of permissions defined on a per-plugin basis in getTaskDefinition,
     * and the user-configured permissions in the workspace settings. The user-configured settings
     * take precedence.
     * @param folderContext The folder context to search for the `swift.pluginPermissions` key.
     * @param taskDefinition The task definition to search for the `disableSandbox` and `allowWritingToPackageDirectory` keys.
     * @param plugin The plugin to generate arguments for.
     * @returns A list of permission related arguments to pass when invoking the plugin.
     */
    private pluginArgumentsFromConfiguration(
        folderContext: vscode.WorkspaceFolder,
        taskDefinition: vscode.TaskDefinition,
        plugin: PackagePlugin
    ): string[] {
        const config = configuration
            .folder(folderContext)
            .pluginPermissions(`${plugin.package}:${plugin.command}`);

        const taskDefinitionConfiguration: PluginPermissionConfiguration = {};
        if (taskDefinition.disableSandbox) {
            taskDefinitionConfiguration.disableSandbox = true;
        }
        if (taskDefinition.allowWritingToPackageDirectory) {
            taskDefinitionConfiguration.allowWritingToPackageDirectory = true;
        }

        return this.pluginArguments({
            ...taskDefinitionConfiguration,
            ...config,
        });
    }

    private pluginArguments(config: PluginPermissionConfiguration): string[] {
        const args = [];
        if (config.allowWritingToPackageDirectory) {
            args.push("--allow-writing-to-package-directory");
        }
        if (config.allowWritingToDirectory) {
            if (Array.isArray(config.allowWritingToPackageDirectory)) {
                args.push("--allow-writing-to-directory", ...config.allowWritingToDirectory);
            } else {
                args.push("--allow-writing-to-directory");
            }
        }
        if (config.allowNetworkConnections) {
            args.push("--allow-network-connections");
            args.push(config.allowNetworkConnections);
        }
        return args;
    }
}
