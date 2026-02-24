//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as path from "path";
import { isDeepStrictEqual } from "util";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import configuration from "../configuration";
import { BuildFlags } from "../toolchain/BuildFlags";
import { stringArrayInEnglish } from "../utilities/utilities";
import { getFolderAndNameSuffix } from "./buildConfig";
import { SWIFT_LAUNCH_CONFIG_TYPE } from "./debugAdapter";

/** Options used to configure {@link makeDebugConfigurations}. */
interface WriteLaunchConfigurationsOptions {
    /** Force the generation of launch configurations regardless of user settings. */
    force?: boolean;

    /** Automatically answer yes to update dialogs. */
    yes?: boolean;
}

/**
 * Edit launch.json based on contents of Swift Package.
 * Adds launch configurations based on the executables in Package.swift.
 *
 * @param ctx folder context to create launch configurations for
 * @param options the options used to configure behavior of this function
 * @returns a boolean indicating whether or not launch configurations were actually updated
 */
export async function makeDebugConfigurations(
    ctx: FolderContext,
    options: WriteLaunchConfigurationsOptions = {}
): Promise<boolean> {
    if (
        !options.force &&
        !configuration.folder(ctx.workspaceFolder).autoGenerateLaunchConfigurations
    ) {
        return false;
    }

    const wsLaunchSection = vscode.workspace.workspaceFile
        ? vscode.workspace.getConfiguration("launch")
        : vscode.workspace.getConfiguration("launch", ctx.folder);
    const launchConfigs = wsLaunchSection.get<vscode.DebugConfiguration[]>("configurations") || [];

    const { configsToCreate, configsToUpdate } = await classifyConfigurations(ctx, launchConfigs);

    const needsUpdate = await applyConfigurationChanges(
        ctx,
        launchConfigs,
        configsToCreate,
        configsToUpdate,
        options
    );

    if (!needsUpdate) {
        return false;
    }

    await wsLaunchSection.update(
        "configurations",
        launchConfigs,
        vscode.workspace.workspaceFile
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.WorkspaceFolder
    );
    return true;
}

async function classifyConfigurations(
    ctx: FolderContext,
    launchConfigs: vscode.DebugConfiguration[]
) {
    const configsToCreate: vscode.DebugConfiguration[] = [];
    const configsToUpdate: { index: number; config: vscode.DebugConfiguration }[] = [];
    for (const generatedConfig of await createExecutableConfigurations(ctx)) {
        const index = launchConfigs.findIndex(c => c.name === generatedConfig.name);
        if (index === -1) {
            configsToCreate.push(generatedConfig);
            continue;
        }

        const config = structuredClone(launchConfigs[index]);
        updateConfigWithNewKeys(config, generatedConfig, [
            "program",
            "target",
            "configuration",
            "cwd",
            "preLaunchTask",
            "type",
        ]);

        if (!isDeepStrictEqual(launchConfigs[index], config)) {
            configsToUpdate.push({ index, config });
        }
    }
    return { configsToCreate, configsToUpdate };
}

async function applyConfigurationChanges(
    ctx: FolderContext,
    launchConfigs: vscode.DebugConfiguration[],
    configsToCreate: vscode.DebugConfiguration[],
    configsToUpdate: { index: number; config: vscode.DebugConfiguration }[],
    options: WriteLaunchConfigurationsOptions
): Promise<boolean> {
    let needsUpdate = false;
    if (configsToCreate.length > 0) {
        launchConfigs.push(...configsToCreate);
        needsUpdate = true;
    }
    if (configsToUpdate.length > 0) {
        let answer: "Update" | "Cancel" | undefined = options.yes ? "Update" : undefined;
        if (!answer) {
            const configUpdateNames = stringArrayInEnglish(
                configsToUpdate.map(update => update.config.name)
            );
            const warningMessage = `The Swift extension would like to update launch configurations '${configUpdateNames}'.`;
            answer = await vscode.window.showWarningMessage(
                `${ctx.name}: ${warningMessage} Do you want to update?`,
                "Update",
                "Cancel"
            );
        }

        if (answer === "Update") {
            configsToUpdate.forEach(update => (launchConfigs[update.index] = update.config));
            needsUpdate = true;
        }
    }
    return needsUpdate;
}

export async function getTargetBinaryPath(
    targetName: string,
    buildConfiguration: "debug" | "release",
    folderCtx: FolderContext,
    extraArgs: string[] = []
): Promise<string> {
    try {
        // Use dynamic path resolution with --show-bin-path
        const binPath = await folderCtx.toolchain.buildFlags.getBuildBinaryPath(
            folderCtx.folder.fsPath,
            buildConfiguration,
            folderCtx.workspaceContext.logger,
            "",
            extraArgs
        );
        return path.join(binPath, targetName);
    } catch (error) {
        // Fallback to traditional path construction if dynamic resolution fails
        return getLegacyTargetBinaryPath(targetName, buildConfiguration, folderCtx);
    }
}

function getLegacyTargetBinaryPath(
    targetName: string,
    buildConfiguration: "debug" | "release",
    folderCtx: FolderContext
): string {
    return path.join(
        BuildFlags.buildDirectoryFromWorkspacePath(folderCtx.folder.fsPath, true),
        buildConfiguration,
        targetName
    );
}

/** Expands VS Code variables such as ${workspaceFolder} in the given string. */
function expandVariables(str: string): string {
    let expandedStr = str;
    const availableWorkspaceFolders = vscode.workspace.workspaceFolders ?? [];
    // Expand the top level VS Code workspace folder.
    if (availableWorkspaceFolders.length > 0) {
        expandedStr = expandedStr.replaceAll(
            "${workspaceFolder}",
            availableWorkspaceFolders[0].uri.fsPath
        );
    }
    // Expand each available VS Code workspace folder.
    for (const workspaceFolder of availableWorkspaceFolders) {
        expandedStr = expandedStr.replaceAll(
            `$\{workspaceFolder:${workspaceFolder.name}}`,
            workspaceFolder.uri.fsPath
        );
    }
    return expandedStr;
}

// Return debug launch configuration for an executable in the given folder
export async function getLaunchConfiguration(
    target: string,
    buildConfiguration: "debug" | "release",
    folderCtx: FolderContext
): Promise<vscode.DebugConfiguration | undefined> {
    const wsLaunchSection = vscode.workspace.workspaceFile
        ? vscode.workspace.getConfiguration("launch")
        : vscode.workspace.getConfiguration("launch", folderCtx.workspaceFolder);
    const launchConfigs = wsLaunchSection.get<vscode.DebugConfiguration[]>("configurations") || [];
    const targetPath = await getTargetBinaryPath(target, buildConfiguration, folderCtx);
    const legacyTargetPath = getLegacyTargetBinaryPath(target, buildConfiguration, folderCtx);
    return launchConfigs.find(config => {
        // Newer launch configs use "target" and "configuration" properties which are easier to query.
        if (config.target) {
            const configBuildConfiguration = config.configuration ?? "debug";
            return config.target === target && configBuildConfiguration === buildConfiguration;
        }
        // Users could be on different platforms with different path annotations, so normalize before we compare.
        const normalizedConfigPath = path.normalize(expandVariables(config.program));
        const normalizedTargetPath = path.normalize(targetPath);
        const normalizedLegacyTargetPath = path.normalize(legacyTargetPath);
        // Old launch configs had program paths that looked like "${workspaceFolder:test}/defaultPackage/.build/debug",
        // where `debug` was a symlink to the <host-triple-folder>/debug. We want to support both old and new, so we're
        // comparing against both to find a match.
        return [normalizedTargetPath, normalizedLegacyTargetPath].includes(normalizedConfigPath);
    });
}

// Return array of DebugConfigurations for executables based on what is in Package.swift
async function createExecutableConfigurations(
    ctx: FolderContext
): Promise<vscode.DebugConfiguration[]> {
    const executableProducts = await ctx.swiftPackage.executableProducts;

    // Windows understand the forward slashes, so make the configuration unified as posix path
    // to make it easier for users switching between platforms.
    const { folder, nameSuffix } = getFolderAndNameSuffix(ctx, undefined, "posix");

    return executableProducts.flatMap(product => {
        const baseConfig = {
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            args: [],
            cwd: folder,
        };
        return [
            {
                ...baseConfig,
                name: `Debug ${product.name}${nameSuffix}`,
                target: product.name,
                configuration: "debug",
                preLaunchTask: `swift: Build Debug ${product.name}${nameSuffix}`,
            },
            {
                ...baseConfig,
                name: `Release ${product.name}${nameSuffix}`,
                target: product.name,
                configuration: "release",
                preLaunchTask: `swift: Build Release ${product.name}${nameSuffix}`,
            },
        ];
    });
}

/**
 * Create Debug configuration for running a Swift Snippet
 * @param snippetName Name of Swift Snippet to run
 * @param ctx Folder context for project
 * @returns Debug configuration for running Swift Snippet
 */
export async function createSnippetConfiguration(
    snippetName: string,
    ctx: FolderContext
): Promise<vscode.DebugConfiguration> {
    const { folder } = getFolderAndNameSuffix(ctx);

    try {
        // Use dynamic path resolution with --show-bin-path
        const binPath = await ctx.toolchain.buildFlags.getBuildBinaryPath(
            ctx.folder.fsPath,
            "debug",
            ctx.workspaceContext.logger,
            "snippet"
        );

        return {
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            name: `Run ${snippetName}`,
            program: path.posix.join(binPath, snippetName),
            args: [],
            cwd: folder,
            runType: "snippet",
        };
    } catch (error) {
        // Fallback to traditional path construction if dynamic resolution fails
        const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(folder, true);

        return {
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            name: `Run ${snippetName}`,
            program: path.posix.join(buildDirectory, "debug", snippetName),
            args: [],
            cwd: folder,
            runType: "snippet",
        };
    }
}

/**
 * Run debugger for given configuration
 * @param config Debug configuration
 * @param workspaceFolder Workspace to run debugger in
 */
export async function debugLaunchConfig(
    workspaceFolder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    options: vscode.DebugSessionOptions = {}
) {
    return new Promise<boolean>((resolve, reject) => {
        vscode.debug.startDebugging(workspaceFolder, config, options).then(
            started => {
                if (started) {
                    const terminateSession = vscode.debug.onDidTerminateDebugSession(async () => {
                        // dispose terminate debug handler
                        terminateSession.dispose();
                        resolve(true);
                    });
                } else {
                    resolve(false);
                }
            },
            reason => {
                reject(reason);
            }
        );
    });
}

/** Update the provided debug configuration with keys from a newly generated configuration. */
function updateConfigWithNewKeys(
    oldConfig: vscode.DebugConfiguration,
    newConfig: vscode.DebugConfiguration,
    keys: string[]
) {
    for (const key of keys) {
        if (newConfig[key] === undefined) {
            delete oldConfig[key];
            continue;
        }
        oldConfig[key] = newConfig[key];
    }
}

/**
 * Get the arguments for a launch configuration's preLaunchTask if it's a Swift build task
 * @param launchConfig The launch configuration to check
 * @param workspaceFolder The workspace folder context (optional)
 * @returns Promise<string[] | undefined> the task arguments if it's a Swift build task, undefined otherwise
 */
export async function swiftPrelaunchBuildTaskArguments(
    launchConfig: vscode.DebugConfiguration,
    workspaceFolder?: vscode.WorkspaceFolder
): Promise<string[] | undefined> {
    const preLaunchTask = launchConfig.preLaunchTask;

    if (!preLaunchTask || typeof preLaunchTask !== "string") {
        return undefined;
    }

    try {
        // Fetch all available tasks
        const allTasks = await vscode.tasks.fetchTasks();

        // Find the task by name
        const task = allTasks.find(t => {
            // Check if task name matches (with or without "swift: " prefix)
            const taskName = t.name;
            const matches =
                taskName === preLaunchTask ||
                taskName === `swift: ${preLaunchTask}` ||
                `swift: ${taskName}` === preLaunchTask;

            // If workspace folder is specified, also check scope
            if (workspaceFolder && matches) {
                return t.scope === workspaceFolder || t.scope === vscode.TaskScope.Workspace;
            }

            return matches;
        });

        if (!task) {
            return undefined;
        }

        // Check if task type is "swift"
        if (task.definition.type !== "swift") {
            return undefined;
        }

        // Check if args contain "build"
        const args = (task.definition.args as string[]) || [];
        const hasBuild = args.includes("build");
        return hasBuild ? args : undefined;
    } catch (error) {
        // Log error but don't throw - return undefined for safety
        return undefined;
    }
}
