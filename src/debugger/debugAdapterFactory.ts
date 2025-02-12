//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
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
import { DebugAdapter, LaunchConfigType, SWIFT_LAUNCH_CONFIG_TYPE } from "./debugAdapter";
import { registerLoggingDebugAdapterTracker } from "./logTracker";
import { SwiftToolchain } from "../toolchain/toolchain";
import { SwiftOutputChannel } from "../ui/SwiftOutputChannel";

/**
 * Registers the active debugger with the extension, and reregisters it
 * when the debugger settings change.
 * @param workspaceContext  The workspace context
 * @returns A disposable to be disposed when the extension is deactivated
 */
export function registerDebugger(workspaceContext: WorkspaceContext): vscode.Disposable {
    async function updateDebugAdapter() {
        await workspaceContext.setLLDBVersion();

        // Verify that the adapter exists, but only after registration. This async method
        // is basically an unstructured task so we don't want to run it before the adapter
        // registration above as it could cause code executing immediately after register()
        // to use the incorrect adapter.
        DebugAdapter.verifyDebugAdapterExists(
            workspaceContext.toolchain,
            workspaceContext.outputChannel,
            true
        ).catch(error => {
            workspaceContext.outputChannel.log(error);
        });
    }

    const subscriptions: vscode.Disposable[] = [
        registerLoggingDebugAdapterTracker(),
        registerLLDBDebugAdapter(workspaceContext.toolchain, workspaceContext.outputChannel),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("swift.debugger.useDebugAdapterFromToolchain")) {
                updateDebugAdapter();
            }
        }),
    ];

    // Perform the initial registration, then reregister every time the settings change.
    updateDebugAdapter();

    return {
        dispose: () => {
            subscriptions.map(sub => sub.dispose());
        },
    };
}

/**
 * Registers the LLDB debug adapter with the VS Code debug adapter descriptor factory.
 * @param workspaceContext The workspace context
 * @returns A disposable to be disposed when the extension is deactivated
 */
function registerLLDBDebugAdapter(
    toolchain: SwiftToolchain,
    outputChannel: SwiftOutputChannel
): vscode.Disposable {
    const debugAdpaterFactory = vscode.debug.registerDebugAdapterDescriptorFactory(
        SWIFT_LAUNCH_CONFIG_TYPE,
        new LLDBDebugAdapterExecutableFactory(toolchain, outputChannel)
    );

    const debugConfigProvider = vscode.debug.registerDebugConfigurationProvider(
        SWIFT_LAUNCH_CONFIG_TYPE,
        new LLDBDebugConfigurationProvider(process.platform, toolchain)
    );

    return {
        dispose: () => {
            debugConfigProvider.dispose();
            debugAdpaterFactory.dispose();
        },
    };
}

/**
 * A factory class for creating and providing the executable descriptor for the LLDB Debug Adapter.
 * This class implements the vscode.DebugAdapterDescriptorFactory interface and is responsible for
 * determining the path to the LLDB Debug Adapter executable and ensuring it exists before launching
 * a debug session.
 *
 * This class uses the workspace context to:
 *  - Resolve the path to the debug adapter executable.
 *  - Verify that the debug adapter exists in the toolchain.
 *
 * The main method of this class, `createDebugAdapterDescriptor`, is invoked by VS Code to supply
 * the debug adapter executable when a debug session is started. The executable parameter by default
 * will be provided in package.json > contributes > debuggers > program if defined, but since we will
 * determine the executable via the toolchain anyway, this is now redundant and will be ignored.
 *
 * @implements {vscode.DebugAdapterDescriptorFactory}
 */
export class LLDBDebugAdapterExecutableFactory implements vscode.DebugAdapterDescriptorFactory {
    private toolchain: SwiftToolchain;
    private outputChannel: SwiftOutputChannel;

    constructor(toolchain: SwiftToolchain, outputChannel: SwiftOutputChannel) {
        this.toolchain = toolchain;
        this.outputChannel = outputChannel;
    }

    async createDebugAdapterDescriptor(): Promise<vscode.DebugAdapterDescriptor> {
        const path = await DebugAdapter.debugAdapterPath(this.toolchain);
        await DebugAdapter.verifyDebugAdapterExists(this.toolchain, this.outputChannel);
        return new vscode.DebugAdapterExecutable(path, [], {});
    }
}

/** Provide configurations for lldb-vscode/lldb-dap
 *
 * Converts launch configuration that user supplies into a version that the lldb-vscode/lldb-dap
 * debug adapter will use. Primarily it converts the environment variables from Object
 * to an array of strings in format "var=value".
 *
 * This could also be used to augment the configuration with values from the settings
 * although it isn't at the moment.
 */
export class LLDBDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(
        private platform: NodeJS.Platform,
        private toolchain: SwiftToolchain
    ) {}

    async resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        launchConfig: vscode.DebugConfiguration
    ): Promise<vscode.DebugConfiguration | undefined | null> {
        // Fix the program path on Windows to include the ".exe" extension
        if (
            this.platform === "win32" &&
            launchConfig.testType === undefined &&
            path.extname(launchConfig.program) !== ".exe"
        ) {
            launchConfig.program += ".exe";
        }

        // Delegate to the appropriate debug adapter extension
        launchConfig.type = DebugAdapter.getLaunchConfigType(this.toolchain.swiftVersion);
        if (launchConfig.type === LaunchConfigType.CODE_LLDB) {
            launchConfig.sourceLanguages = ["swift"];
        } else if (launchConfig.type === LaunchConfigType.LLDB_DAP) {
            if (launchConfig.env) {
                launchConfig.env = this.convertEnvironmentVariables(launchConfig.env);
            }
        }

        return launchConfig;
    }

    private convertEnvironmentVariables(map: { [key: string]: string }): string[] {
        return Object.entries(map).map(([key, value]) => `${key}=${value}`);
    }
}
