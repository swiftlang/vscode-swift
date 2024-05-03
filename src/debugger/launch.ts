//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2023 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import configuration from "../configuration";
import { FolderContext } from "../FolderContext";
import { BuildFlags } from "../toolchain/BuildFlags";
import { stringArrayInEnglish, swiftLibraryPathKey, swiftRuntimeEnv } from "../utilities/utilities";
import { DebugAdapter } from "./debugAdapter";
import { TargetType } from "../SwiftPackage";

/**
 * Edit launch.json based on contents of Swift Package.
 * Adds launch configurations based on the executables in Package.swift.
 *
 * @param ctx folder context to create launch configurations for
 * @param yes automatically answer yes to dialogs
 */
export async function makeDebugConfigurations(ctx: FolderContext, message?: string, yes = false) {
    if (!configuration.folder(ctx.workspaceFolder).autoGenerateLaunchConfigurations) {
        return;
    }
    const wsLaunchSection = vscode.workspace.getConfiguration("launch", ctx.folder);
    const launchConfigs = wsLaunchSection.get<vscode.DebugConfiguration[]>("configurations") || [];
    // list of keys that can be updated in config merge
    const keysToUpdate = [
        "program",
        "cwd",
        "preLaunchTask",
        "type",
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
}

// Return debug launch configuration for an executable in the given folder
export function getLaunchConfiguration(
    target: string,
    folderCtx: FolderContext
): vscode.DebugConfiguration | undefined {
    const wsLaunchSection = vscode.workspace.getConfiguration("launch", folderCtx.folder);
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
    const { folder, nameSuffix } = getFolderAndNameSuffix(ctx);
    const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(folder, true);
    const binaryExtension = process.platform === "win32" ? ".exe" : "";
    return executableProducts.flatMap(product => {
        const baseConfig = {
            type: DebugAdapter.adapterName,
            request: "launch",
            sourceLanguages: ["swift"],
            args: [],
            cwd: folder,
            env: swiftRuntimeEnv(true),
        };
        return [
            {
                ...baseConfig,
                name: `Debug ${product.name}${nameSuffix}`,
                program: path.join(buildDirectory, "debug", product.name + binaryExtension),
                preLaunchTask: `swift: Build Debug ${product.name}${nameSuffix}`,
            },
            {
                ...baseConfig,
                name: `Release ${product.name}${nameSuffix}`,
                program: path.join(buildDirectory, "release", product.name + binaryExtension),
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
        type: DebugAdapter.adapterName,
        request: "launch",
        sourceLanguages: ["swift"],
        name: `Run ${snippetName}`,
        program: path.join(buildDirectory, "debug", snippetName),
        args: [],
        cwd: folder,
        env: swiftRuntimeEnv(true),
    };
}

export function createSwiftTestConfiguration(
    ctx: FolderContext,
    fifoPipePath: string,
    expandEnvVariables = false
): vscode.DebugConfiguration | null {
    return createDebugConfiguration(ctx, fifoPipePath, expandEnvVariables, "swift-testing");
}

/**
 * Return array of DebugConfigurations for tests based on what is in Package.swift
 * @param ctx Folder context
 * @param fullPath should we return configuration with full paths instead of environment vars
 * @returns debug configuration
 */
export function createXCTestConfiguration(
    ctx: FolderContext,
    expandEnvVariables = false
): vscode.DebugConfiguration | null {
    return createDebugConfiguration(ctx, "", expandEnvVariables, "XCTest");
}

function createDebugConfiguration(
    ctx: FolderContext,
    fifoPipePath: string,
    expandEnvVariables = false,
    type: "XCTest" | "swift-testing"
): vscode.DebugConfiguration | null {
    if (ctx.swiftPackage.getTargets(TargetType.test).length === 0) {
        return null;
    }

    const testEnv = {
        ...swiftRuntimeEnv(),
        ...configuration.folder(ctx.workspaceFolder).testEnvironmentVariables,
    };
    const { folder, nameSuffix } = getFolderAndNameSuffix(ctx, expandEnvVariables);
    const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(folder, true);

    const baseConfig = {
        type: DebugAdapter.adapterName,
        request: "launch",
        sourceLanguages: ["swift"],
        name: `Test ${ctx.swiftPackage.name}`,
        cwd: folder,
        preLaunchTask: `swift: Build All${nameSuffix}`,
    };

    let programPath;
    let args: string[] = [];
    let preRunCommands: string[] | undefined;
    let env: object = {};

    const swiftFolderPath = ctx.workspaceContext.toolchain.swiftFolderPath;
    if (swiftFolderPath === undefined) {
        return null;
    }

    const xcTestPath = ctx.workspaceContext.toolchain.xcTestPath;
    const runtimePath = ctx.workspaceContext.toolchain.runtimePath;
    const sdkroot = configuration.sdk === "" ? process.env.SDKROOT : configuration.sdk;
    const libraryPath = ctx.workspaceContext.toolchain.swiftTestingLibraryPath();
    const frameworkPath = ctx.workspaceContext.toolchain.swiftTestingFrameworkPath();
    const sanitizer = ctx.workspaceContext.toolchain.sanitizer(configuration.sanitizer);

    switch (process.platform) {
        case "darwin":
            switch (type) {
                case "swift-testing":
                    programPath = path.join(
                        buildDirectory,
                        "debug",
                        `${ctx.swiftPackage.name}PackageTests.swift-testing`
                    );
                    args = ["--experimental-event-stream-output", fifoPipePath];
                    env = {
                        ...testEnv,
                        ...sanitizer?.runtimeEnvironment,
                        DYLD_FRAMEWORK_PATH: frameworkPath,
                        DYLD_LIBRARY_PATH: libraryPath,
                        SWT_SF_SYMBOLS_ENABLED: "0",
                    };
                    break;
                case "XCTest":
                    // On macOS, find the path to xctest
                    // and point it at the .xctest bundle from the configured build directory.
                    if (xcTestPath === undefined) {
                        return null;
                    }

                    programPath = path.join(xcTestPath, "xctest");
                    args = [
                        path.join(
                            buildDirectory,
                            "debug",
                            ctx.swiftPackage.name + "PackageTests.xctest"
                        ),
                    ];
                    env = { ...testEnv, ...sanitizer?.runtimeEnvironment };
                    break;
            }
            break;
        case "win32":
            switch (type) {
                case "swift-testing":
                    // On Windows, add XCTest.dll to the Path
                    // and run the .xctest executable from the .build directory.
                    if (xcTestPath === undefined) {
                        return null;
                    }
                    if (xcTestPath !== runtimePath) {
                        testEnv.Path = `${xcTestPath};${testEnv.Path ?? process.env.Path}`;
                    }
                    if (sdkroot === undefined) {
                        return null;
                    }
                    if (
                        configuration.debugger.useDebugAdapterFromToolchain ||
                        vscode.workspace.getConfiguration("lldb")?.get<string>("library")
                    ) {
                        preRunCommands = [`settings set target.sdk-path ${sdkroot}`];
                    }

                    programPath = path.join(
                        buildDirectory,
                        "debug",
                        `${ctx.swiftPackage.name}PackageTests.swift-testing`
                    );
                    args = ["--experimental-event-stream-output", fifoPipePath];
                    env = testEnv;
                    break;
                case "XCTest":
                    // On Windows, add XCTest.dll to the Path
                    // and run the .xctest executable from the .build directory.
                    if (xcTestPath === undefined || sdkroot === undefined) {
                        return null;
                    }
                    if (xcTestPath !== runtimePath) {
                        testEnv.Path = `${xcTestPath};${testEnv.Path ?? process.env.Path}`;
                    }

                    if (
                        configuration.debugger.useDebugAdapterFromToolchain ||
                        vscode.workspace.getConfiguration("lldb")?.get<string>("library")
                    ) {
                        preRunCommands = [`settings set target.sdk-path ${sdkroot}`];
                    }

                    programPath = path.join(
                        buildDirectory,
                        "debug",
                        ctx.swiftPackage.name + "PackageTests.xctest"
                    );
                    env = testEnv;
                    break;
            }
            break;
        default:
            switch (type) {
                case "swift-testing":
                    // On Linux, just run the .swift-testing executable from the configured build directory.
                    programPath = path.join(
                        buildDirectory,
                        "debug",
                        `${ctx.swiftPackage.name}PackageTests.swift-testing`
                    );
                    args = ["--experimental-event-stream-output", fifoPipePath];
                    env = {
                        ...testEnv,
                        SWT_SF_SYMBOLS_ENABLED: "0",
                    };
                    break;
                case "XCTest":
                    programPath = path.join(
                        buildDirectory,
                        "debug",
                        ctx.swiftPackage.name + "PackageTests.xctest"
                    );
                    env = testEnv;
            }
    }

    return {
        ...baseConfig,
        program: programPath,
        args: args,
        env: env,
        preRunCommands: preRunCommands,
    };
}

/** Return custom Darwin test configuration that works with Swift 5.6 */
export function createDarwinTestConfiguration(
    ctx: FolderContext,
    args: string
): vscode.DebugConfiguration | null {
    if (ctx.swiftPackage.getTargets(TargetType.test).length === 0) {
        return null;
    }
    if (process.platform !== "darwin") {
        return null;
    }

    const { folder, nameSuffix } = getFolderAndNameSuffix(ctx, true);
    const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(folder, true);
    // On macOS, find the path to xctest
    // and point it at the .xctest bundle from the configured build directory.
    const xctestPath = ctx.workspaceContext.toolchain.xcTestPath;
    if (xctestPath === undefined) {
        return null;
    }
    let arch: string;
    switch (os.arch()) {
        case "x64":
            arch = "x86_64";
            break;
        case "arm64":
            arch = "arm64e";
            break;
        default:
            return null;
    }
    const sanitizer = ctx.workspaceContext.toolchain.sanitizer(configuration.sanitizer);
    const envCommands = Object.entries({
        ...swiftRuntimeEnv(),
        ...configuration.folder(ctx.workspaceFolder).testEnvironmentVariables,
        ...sanitizer?.runtimeEnvironment,
    }).map(([key, value]) => `settings set target.env-vars ${key}="${value}"`);

    return {
        type: DebugAdapter.adapterName,
        request: "custom",
        sourceLanguages: ["swift"],
        name: `Test ${ctx.swiftPackage.name}`,
        targetCreateCommands: [`file -a ${arch} ${xctestPath}/xctest`],
        processCreateCommands: [
            ...envCommands,
            `process launch -w ${folder} -- ${args} ${buildDirectory}/debug/${ctx.swiftPackage.name}PackageTests.xctest`,
        ],
        preLaunchTask: `swift: Build All${nameSuffix}`,
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
    return new Promise<void>((resolve, reject) => {
        vscode.debug.startDebugging(workspaceFolder, config, options).then(
            started => {
                if (started) {
                    const terminateSession = vscode.debug.onDidTerminateDebugSession(async () => {
                        // dispose terminate debug handler
                        terminateSession.dispose();
                        resolve();
                    });
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

function getFolderAndNameSuffix(
    ctx: FolderContext,
    expandEnvVariables = false
): { folder: string; nameSuffix: string } {
    const workspaceFolder = expandEnvVariables
        ? ctx.workspaceFolder.uri.fsPath
        : `\${workspaceFolder:${ctx.workspaceFolder.name}}`;
    let folder: string;
    let nameSuffix: string;
    if (ctx.relativePath.length === 0) {
        folder = workspaceFolder;
        nameSuffix = "";
    } else {
        folder = path.join(workspaceFolder, ctx.relativePath);
        nameSuffix = ` (${ctx.relativePath})`;
    }
    return { folder: folder, nameSuffix: nameSuffix };
}
