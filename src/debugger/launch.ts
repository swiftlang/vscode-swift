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
export interface WriteLaunchConfigurationsOptions {
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

    // Determine which launch configurations need updating/creating
    const configsToCreate: vscode.DebugConfiguration[] = [];
    const configsToUpdate: { index: number; config: vscode.DebugConfiguration }[] = [];
    for (const generatedConfig of await createExecutableConfigurations(ctx)) {
        const index = launchConfigs.findIndex(c => c.name === generatedConfig.name);
        if (index === -1) {
            configsToCreate.push(generatedConfig);
            continue;
        }

        // deep clone the existing config and update with keys from generated config
        const config = structuredClone(launchConfigs[index]);
        updateConfigWithNewKeys(config, generatedConfig, [
            "program",
            "cwd",
            "preLaunchTask",
            "type",
        ]);

        // Check to see if the config has changed
        if (!isDeepStrictEqual(launchConfigs[index], config)) {
            configsToUpdate.push({ index, config });
        }
    }

    // Create/Update launch configurations if necessary
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

// Return debug launch configuration for an executable in the given folder
export function getLaunchConfiguration(
    target: string,
    folderCtx: FolderContext
): vscode.DebugConfiguration | undefined {
    const wsLaunchSection = vscode.workspace.workspaceFile
        ? vscode.workspace.getConfiguration("launch")
        : vscode.workspace.getConfiguration("launch", folderCtx.workspaceFolder);
    const launchConfigs = wsLaunchSection.get<vscode.DebugConfiguration[]>("configurations") || [];
    const { folder } = getFolderAndNameSuffix(folderCtx);
    const targetPath = path.join(
        BuildFlags.buildDirectoryFromWorkspacePath(folder, true),
        "debug",
        target
    );
    // Users could be on different platforms with different path annotations,
    // so normalize before we compare.
    const launchConfig = launchConfigs.find(
        config => path.normalize(config.program) === path.normalize(targetPath)
    );
    return launchConfig;
}

// Return array of DebugConfigurations for executables based on what is in Package.swift
async function createExecutableConfigurations(
    ctx: FolderContext
): Promise<vscode.DebugConfiguration[]> {
    const executableProducts = await ctx.swiftPackage.executableProducts;

    // Windows understand the forward slashes, so make the configuration unified as posix path
    // to make it easier for users switching between platforms.
    const { folder, nameSuffix } = getFolderAndNameSuffix(ctx, undefined, "posix");
    const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(folder, true, "posix");

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
                program: path.posix.join(buildDirectory, "debug", product.name),
                preLaunchTask: `swift: Build Debug ${product.name}${nameSuffix}`,
            },
            {
                ...baseConfig,
                name: `Release ${product.name}${nameSuffix}`,
                program: path.posix.join(buildDirectory, "release", product.name),
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
export function createSnippetConfiguration(
    snippetName: string,
    ctx: FolderContext
): vscode.DebugConfiguration {
    const { folder } = getFolderAndNameSuffix(ctx);
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
