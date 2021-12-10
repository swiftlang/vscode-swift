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

// Edit launch.json based on contents of Swift Package
// Adds launch configurations based on the executables in Package.swift
export async function makeDebugConfigurations(ctx: FolderContext) {
    const wsLaunchSection = vscode.workspace.getConfiguration("launch", ctx.rootFolder.uri);
    const launchConfigs = wsLaunchSection.get<any[]>("configurations") || [];

    let configs = createDebugConfigurations(ctx);
    let edited = false;
    for (const config of configs) {
        const index = launchConfigs.findIndex(c => (c.name === config.name));
        if (index !== -1) {
            if (launchConfigs[index].program !== config.program) {
                const answer = await vscode.window.showErrorMessage(`Launch configuration '${config.name}' already exists. Do you want to update it?`, 'Cancel', 'Update');
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

// Return array of DebugConfigurations based on what is in Package.swift
function createDebugConfigurations(ctx: FolderContext): vscode.DebugConfiguration[] {
    const executableProducts = ctx.swiftPackage.executableProducts;

    return executableProducts.map((product) => {
        return {
            type: "lldb",
            request: "launch",
            name: `Run ${product.name}`,
            program: "${workspaceFolder}/.build/debug/" + product.name,
            args: [],
            cwd: "${workspaceFolder}",
            preLaunchTask: `swift: Build ${product.name}`
        };    
    
    });
}
