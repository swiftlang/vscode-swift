import * as vscode from 'vscode';
import { SwiftContext } from './SwiftContext';
import { exec } from './utilities';

// Edit launch.json based on contents of Swift Package
// Adds launch configurations based on the executables in Package.swift
export async function makeDebugConfigurations(ctx: SwiftContext) {
    const wsLaunchSection = vscode.workspace.getConfiguration("launch", vscode.window.activeTextEditor?.document.uri);
    const launchConfigs = wsLaunchSection.get<any[]>("configurations") || [];

    let configs = await createDebugConfigurations(ctx);
    var edited = false;
    for (const config of configs) {
        const index = launchConfigs.findIndex(c => (c.name === config.name));
        if (index !== -1) {
            if (launchConfigs[index].program !== config.program) {
                const answer = await vscode.window.showErrorMessage(`Launch configuration for '${config.name}' already exists. Do you want to update it?`, 'Cancel', 'Update');
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
async function createDebugConfigurations(ctx: SwiftContext): Promise<vscode.DebugConfiguration[]> {
    // get executable path
    const { stdout } = await exec('swift build --show-bin-path', { cwd: ctx.workspaceRoot });
    let executableFolder = stdout.split("\n", 1)[0];
    let executableTargets = ctx.swiftPackage.getTargets('executable');

    return executableTargets.map((target) => {
        return {
            type: "lldb",
            request: "launch",
            name: `Debug ${target.name}`,
            program: `${executableFolder}/${target.name}`,
            args: [],
            cwd: ctx.workspaceRoot,
            preLaunchTask: "swift: Build All Targets"
        };    
    
    });
}
