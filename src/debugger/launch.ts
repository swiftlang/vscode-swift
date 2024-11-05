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
import * as vscode from "vscode";
import { FolderContext } from "../FolderContext";
import { BuildFlags } from "../toolchain/BuildFlags";
import { stringArrayInEnglish, swiftLibraryPathKey, swiftRuntimeEnv } from "../utilities/utilities";
import { DebugAdapter } from "./debugAdapter";
import { getFolderAndNameSuffix } from "./buildConfig";
import configuration from "../configuration";
import { CI_DISABLE_ASLR } from "./lldb";

/**
 * Edit launch.json based on contents of Swift Package.
 * Adds launch configurations based on the executables in Package.swift.
 *
 * @param ctx folder context to create launch configurations for
 * @param yes automatically answer yes to dialogs
 */
export async function makeDebugConfigurations(
    ctx: FolderContext,
    message?: string,
    yes = false
): Promise<boolean> {
    if (!configuration.folder(ctx.workspaceFolder).autoGenerateLaunchConfigurations) {
        return false;
    }
    const wsLaunchSection = vscode.workspace.getConfiguration("launch", ctx.folder);
    const launchConfigs = wsLaunchSection.get<vscode.DebugConfiguration[]>("configurations") || [];
    // list of keys that can be updated in config merge
    const keysToUpdate = [
        "program",
        "cwd",
        "preLaunchTask",
        "type",
        "disableASLR",
        "initCommands",
        `env.${swiftLibraryPathKey()}`,
    ];
    const configUpdates: { index: number; config: vscode.DebugConfiguration }[] = [];

    const configs = createExecutableConfigurations(ctx);
    let edited = false;
    for (const config of configs) {
        const index = launchConfigs.findIndex(c => c.name === config.name);
        if (index !== -1) {
            // deep clone config and update with keys from calculated config
            const newConfig: vscode.DebugConfiguration = JSON.parse(
                JSON.stringify(launchConfigs[index])
            );
            updateConfigWithNewKeys(newConfig, config, keysToUpdate);

            // if original config is different from new config
            if (JSON.stringify(launchConfigs[index]) !== JSON.stringify(newConfig)) {
                configUpdates.push({ index: index, config: newConfig });
            }
        } else {
            launchConfigs.push(config);
            edited = true;
        }
    }

    if (configUpdates.length > 0) {
        if (!yes) {
            const configUpdateNames = stringArrayInEnglish(
                configUpdates.map(update => update.config.name)
            );
            const warningMessage =
                message ??
                `The Swift extension would like to update launch configurations '${configUpdateNames}'.`;
            const answer = await vscode.window.showWarningMessage(
                `${ctx.name}: ${warningMessage} Do you want to update?`,
                "Update",
                "Cancel"
            );
            if (answer === "Update") {
                yes = true;
            }
        }
        if (yes) {
            configUpdates.forEach(update => (launchConfigs[update.index] = update.config));
            edited = true;
        }
    }

    if (edited) {
        await wsLaunchSection.update(
            "configurations",
            launchConfigs,
            vscode.ConfigurationTarget.WorkspaceFolder
        );
    }
    return true;
}

// Return debug launch configuration for an executable in the given folder
export function getLaunchConfiguration(
    target: string,
    folderCtx: FolderContext
): vscode.DebugConfiguration | undefined {
    const wsLaunchSection = vscode.workspace.getConfiguration("launch", folderCtx.workspaceFolder);
    const launchConfigs = wsLaunchSection.get<vscode.DebugConfiguration[]>("configurations") || [];
    const { folder } = getFolderAndNameSuffix(folderCtx);
    const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(folder, true);
    return launchConfigs.find(
        config => config.program === path.join(buildDirectory, "debug", target)
    );
}

// Return array of DebugConfigurations for executables based on what is in Package.swift
function createExecutableConfigurations(ctx: FolderContext): vscode.DebugConfiguration[] {
    const executableProducts = ctx.swiftPackage.executableProducts;
    const { folder, nameSuffix } = getFolderAndNameSuffix(ctx, undefined, "posix");
    const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(folder, true, "posix");
    return executableProducts.flatMap(product => {
        const baseConfig = {
            type: DebugAdapter.getLaunchConfigType(ctx.workspaceContext.swiftVersion),
            request: "launch",
            args: [],
            cwd: folder,
            env: swiftRuntimeEnv(true),
            ...CI_DISABLE_ASLR,
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
        type: DebugAdapter.getLaunchConfigType(ctx.workspaceContext.swiftVersion),
        request: "launch",
        name: `Run ${snippetName}`,
        program: path.posix.join(buildDirectory, "debug", snippetName),
        args: [],
        cwd: folder,
        env: swiftRuntimeEnv(true),
        ...CI_DISABLE_ASLR,
    };
}

/**
 * Run debugger for given configuration
 * @param config Debug configuration
 * @param workspaceFolder Workspace to run debugger in
 */
export async function debugLaunchConfig(
    workspaceFolder: vscode.WorkspaceFolder,
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

/** Return the base configuration with (nested) keys updated with the new one. */
function updateConfigWithNewKeys(
    baseConfiguration: vscode.DebugConfiguration,
    newConfiguration: vscode.DebugConfiguration,
    keys: string[]
) {
    keys.forEach(key => {
        // We're manually handling `undefined`s during nested update, so even if the depth
        // is restricted to 2, the implementation still looks a bit messy.
        if (key.includes(".")) {
            const [mainKey, subKey] = key.split(".", 2);
            if (baseConfiguration[mainKey] === undefined) {
                // { mainKey: unknown | undefined } -> { mainKey: undefined }
                baseConfiguration[mainKey] = newConfiguration[mainKey];
            } else if (newConfiguration[mainKey] === undefined) {
                const subKeys = Object.keys(baseConfiguration[mainKey]);
                if (subKeys.length === 1 && subKeys[0] === subKey) {
                    // { mainKey: undefined } -> { mainKey: { subKey: unknown } }
                    baseConfiguration[mainKey] = undefined;
                } else {
                    // { mainKey: undefined } -> { mainKey: { subKey: unknown | undefined, ... } }
                    baseConfiguration[mainKey][subKey] = undefined;
                }
            } else {
                // { mainKey: { subKey: unknown | undefined } } -> { mainKey: { subKey: unknown | undefined, ... } }
                baseConfiguration[mainKey][subKey] = newConfiguration[mainKey][subKey];
            }
        } else {
            // { key: unknown | undefined } -> { key: unknown | undefined, ... }
            baseConfiguration[key] = newConfiguration[key];
        }
    });
}
