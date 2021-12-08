import * as vscode from 'vscode';
import { SwiftContext } from './SwiftContext';
import { exec } from './utilities';

// Edit launch.json based on contents of Swift Package
// Adds launch configurations based on the executables in Package.swift
export async function makeDebugConfigurations(ctx: SwiftContext) {
    const wsLaunchSection = vscode.workspace.getConfiguration("launch", vscode.window.activeTextEditor?.document.uri);
    const launchConfigs = wsLaunchSection.get<any[]>("configurations") || [];

    let configs = createDebugConfigurations(ctx);
    var edited = false;
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
function createDebugConfigurations(ctx: SwiftContext): vscode.DebugConfiguration[] {
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
