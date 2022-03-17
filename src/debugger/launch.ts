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

import * as os from "os";
import * as vscode from "vscode";
import { FolderContext } from "../FolderContext";

/**
 * Edit launch.json based on contents of Swift Package.
 * Adds launch configurations based on the executables in Package.swift.
 *
 * @param ctx folder context to create launch configurations for
 */
export async function makeDebugConfigurations(ctx: FolderContext) {
    const wsLaunchSection = vscode.workspace.getConfiguration("launch", ctx.folder);
    const launchConfigs = wsLaunchSection.get<vscode.DebugConfiguration[]>("configurations") || [];

    const configs = createExecutableConfigurations(ctx);
    let edited = false;
    for (const config of configs) {
        const index = launchConfigs.findIndex(c => c.name === config.name);
        if (index !== -1) {
            if (
                launchConfigs[index].program !== config.program ||
                launchConfigs[index].cwd !== config.cwd ||
                launchConfigs[index].preLaunchTask !== config.preLaunchTask
            ) {
                const answer = await vscode.window.showErrorMessage(
                    `${ctx.name}: Launch configuration '${config.name}' already exists. Do you want to update it?`,
                    "Cancel",
                    "Update"
                );
                if (answer === "Cancel") {
                    continue;
                }
                launchConfigs[index] = config;
                edited = true;
            }
        } else {
            launchConfigs.push(config);
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

// Return array of DebugConfigurations for executables based on what is in Package.swift
function createExecutableConfigurations(ctx: FolderContext): vscode.DebugConfiguration[] {
    const executableProducts = ctx.swiftPackage.executableProducts;
    let folder: string;
    let nameSuffix: string;
    if (ctx.relativePath.length === 0) {
        folder = `\${workspaceFolder:${ctx.workspaceFolder.name}}`;
        nameSuffix = "";
    } else {
        folder = `\${workspaceFolder:${ctx.workspaceFolder.name}}/${ctx.relativePath}`;
        nameSuffix = ` (${ctx.relativePath})`;
    }
    return executableProducts.flatMap(product => {
        return [
            {
                type: "lldb",
                request: "launch",
                name: `Debug ${product.name}${nameSuffix}`,
                program: `${folder}/.build/debug/` + product.name,
                args: [],
                cwd: folder,
                preLaunchTask: `swift: Build Debug ${product.name}${nameSuffix}`,
            },
            {
                type: "lldb",
                request: "launch",
                name: `Release ${product.name}${nameSuffix}`,
                program: `${folder}/.build/release/` + product.name,
                args: [],
                cwd: folder,
                preLaunchTask: `swift: Build Release ${product.name}${nameSuffix}`,
            },
        ];
    });
}

// Return array of DebugConfigurations for tests based on what is in Package.swift
export function createTestConfiguration(ctx: FolderContext): vscode.DebugConfiguration | null {
    if (ctx.swiftPackage.getTargets("test").length === 0) {
        return null;
    }

    let folder: string;
    let nameSuffix: string;
    if (ctx.relativePath.length === 0) {
        folder = `\${workspaceFolder:${ctx.workspaceFolder.name}}`;
        nameSuffix = "";
    } else {
        folder = `\${workspaceFolder:${ctx.workspaceFolder.name}}/${ctx.relativePath}`;
        nameSuffix = ` (${ctx.relativePath})`;
    }
    if (process.platform === "darwin") {
        // On macOS, find the path to xctest
        // and point it at the .xctest bundle from the .build directory.
        const xctestPath = ctx.workspaceContext.toolchain.xcTestPath;
        if (xctestPath === undefined) {
            return null;
        }
        return {
            type: "lldb",
            request: "launch",
            name: `Test ${ctx.swiftPackage.name}`,
            program: `${xctestPath}/xctest`,
            args: [`.build/debug/${ctx.swiftPackage.name}PackageTests.xctest`],
            cwd: folder,
            preLaunchTask: `swift: Build All${nameSuffix}`,
        };
    } else if (process.platform === "win32") {
        // On Windows, add XCTest.dll to the PATH,
        // and then run the .xctest bundle from the .build directory.
        if (!ctx.workspaceContext.toolchain.developerDir) {
            return null;
        }
        return {
            type: "lldb",
            request: "launch",
            name: `Test ${ctx.swiftPackage.name}`,
            program: `${folder}/.build/debug/${ctx.swiftPackage.name}PackageTests.xctest`,
            cwd: folder,
            env: {
                path: `${ctx.workspaceContext.toolchain.xcTestPath};\${env:PATH}`,
            },
            preLaunchTask: `swift: Build All${nameSuffix}`,
        };
    } else {
        // On Linux, just run the .xctest bundle from the .build directory.
        return {
            type: "lldb",
            request: "launch",
            name: `Test ${ctx.swiftPackage.name}`,
            program: `${folder}/.build/debug/${ctx.swiftPackage.name}PackageTests.xctest`,
            cwd: folder,
            preLaunchTask: `swift: Build All${nameSuffix}`,
        };
    }
}

/** Return custom Darwin test configuration that works with Swift 5.6 */
export function createDarwinTestConfiguration(
    ctx: FolderContext,
    args: string,
    outputFile: string
): vscode.DebugConfiguration | null {
    if (ctx.swiftPackage.getTargets("test").length === 0) {
        return null;
    }
    if (process.platform !== "darwin") {
        return null;
    }

    let folder: string;
    let nameSuffix: string;
    if (ctx.relativePath.length === 0) {
        folder = `\${workspaceFolder:${ctx.workspaceFolder.name}}`;
        nameSuffix = "";
    } else {
        folder = `\${workspaceFolder:${ctx.workspaceFolder.name}}/${ctx.relativePath}`;
        nameSuffix = ` (${ctx.relativePath})`;
    }
    // On macOS, find the path to xctest
    // and point it at the .xctest bundle from the .build directory.
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
    return {
        type: "lldb",
        request: "custom",
        name: `Test ${ctx.swiftPackage.name}`,
        targetCreateCommands: [`file -a ${arch} ${xctestPath}/xctest`],
        processCreateCommands: [
            `process launch -o ${outputFile} -e ${outputFile} -- ${args} .build/debug/${ctx.swiftPackage.name}PackageTests.xctest`,
        ],
        cwd: folder,
        preLaunchTask: `swift: Build All${nameSuffix}`,
    };
}
