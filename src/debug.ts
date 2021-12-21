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

import * as vscode from 'vscode';
import { FolderContext } from './FolderContext';
import { getXcodePath } from './utilities';

/** 
 * Edit launch.json based on contents of Swift Package.
 * Adds launch configurations based on the executables in Package.swift.
 * 
 * @param ctx folder context to create launch configurations for
 */
export async function makeDebugConfigurations(ctx: FolderContext) {
    const wsLaunchSection = vscode.workspace.getConfiguration("launch", ctx.folder);
    const launchConfigs = wsLaunchSection.get<vscode.DebugConfiguration[]>("configurations") || [];

    const configs = [
        ...createExecutableConfigurations(ctx),
        ...await createTestConfigurations(ctx)
    ];
    let edited = false;
    for (const config of configs) {
        const index = launchConfigs.findIndex(c => c.name === config.name);
        if (index !== -1) {
            if (launchConfigs[index].program !== config.program || 
                launchConfigs[index].cwd !== config.cwd ||
                launchConfigs[index].preLaunchTask !== config.preLaunchTask) {
                const answer = await vscode.window.showErrorMessage(
                    `Launch configuration '${config.name}' already exists. Do you want to update it?`, 
                    'Cancel', 'Update'
                );
                if (answer === "Cancel") { continue; }
                launchConfigs[index] = config;
                edited = true;
            }
        } else {
            launchConfigs.push(config);
            edited = true;
        }    
    }

    if (edited) {
        await wsLaunchSection.update("configurations", launchConfigs);
    }
}

// Return array of DebugConfigurations for executables based on what is in Package.swift
function createExecutableConfigurations(ctx: FolderContext): vscode.DebugConfiguration[] {
    const executableProducts = ctx.swiftPackage.executableProducts;

    return executableProducts.flatMap((product) => {
        return [
            {
                type: "lldb",
                request: "launch",
                name: `Debug ${product.name}`,
                program: "${workspaceFolder}/.build/debug/" + product.name,
                args: [],
                cwd: `\${workspaceFolder:${ctx.folder.name}}`,
                preLaunchTask: `swift: Build Debug ${product.name}`
            },
            {
                type: "lldb",
                request: "launch",
                name: `Release ${product.name}`,
                program: "${workspaceFolder}/.build/release/" + product.name,
                args: [],
                cwd: `\${workspaceFolder:${ctx.folder.name}}`,
                preLaunchTask: `swift: Build Release ${product.name}`
            }
        ];    
    });
}

// Return array of DebugConfigurations for tests based on what is in Package.swift
async function createTestConfigurations(ctx: FolderContext): Promise<vscode.DebugConfiguration[]> {
    if (ctx.swiftPackage.getTargets('test').length === 0) { return []; }
    // if platform is windows temporarily disable test launch config generation until we work
    // out how to run the test executable on windows
    if (process.platform === "win32") { return []; }

    // If running on darwin. Find xctest exe and run pointing at xctest resources
    if (process.platform === 'darwin') {
        const xcodePath = await getXcodePath();
        if (xcodePath === undefined) {
            return [];
        }
        return [{
            type: "lldb",
            request: "launch",
            name: `Test ${ctx.swiftPackage.name}`,
            program: `${xcodePath}/usr/bin/xctest`,
            args: [`.build/debug/${ctx.swiftPackage.name}PackageTests.xctest`],
            cwd: `\${workspaceFolder:${ctx.folder.name}}`,
            preLaunchTask: `swift: Build All`
        }];
    } else {
        // otherwise run xctest exe inside build folder
        return [{
            type: "lldb",
            request: "launch",
            name: `Test ${ctx.swiftPackage.name}`,
            program: `./.build/debug/${ctx.swiftPackage.name}PackageTests.xctest`,
            cwd: `\${workspaceFolder:${ctx.folder.name}}`,
            preLaunchTask: `swift: Build All`
        }];
    }

    return [];
}
