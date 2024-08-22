//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2023 the VS Code Swift project authors
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
import { DebugAdapter } from "./debugAdapter";
import { Version } from "../utilities/version";

export function registerLLDBDebugAdapter(workspaceContext: WorkspaceContext): vscode.Disposable {
    class LLDBDebugAdapterExecutableFactory implements vscode.DebugAdapterDescriptorFactory {
        async createDebugAdapterDescriptor(
            _session: vscode.DebugSession,
            executable: vscode.DebugAdapterExecutable | undefined
        ): Promise<vscode.DebugAdapterDescriptor> {
            if (executable) {
                // make VS Code launch the debug adapter executable
                return executable;
            }

            const adapterPath = await DebugAdapter.debugAdapterPath(workspaceContext.toolchain);
            await DebugAdapter.verifyDebugAdapterExists(workspaceContext);
            return new vscode.DebugAdapterExecutable(adapterPath, [], {});
        }
    }

    const debugAdpaterFactory = vscode.debug.registerDebugAdapterDescriptorFactory(
        "swift-lldb",
        new LLDBDebugAdapterExecutableFactory()
    );
    const debugConfigProvider = vscode.debug.registerDebugConfigurationProvider(
        "swift-lldb",
        new LLDBDebugConfigurationProvider(
            process.platform,
            workspaceContext.toolchain.swiftVersion
        )
    );
    return {
        dispose: () => {
            debugConfigProvider.dispose();
            debugAdpaterFactory.dispose();
        },
    };
}

/** Provide configurations for lldb-vscode/lldb-dap
 *
 * Converts launch configuration that user supplies into a version that the lldb-vscode/lldb-dap
 * debug adapter will use. Primarily it converts the environment variables from Object
 * to an array of strings in format "var=value".
 *
 * This could also be used to augment the configuration with values from the settings
 * althought it isn't at the moment.
 */
export class LLDBDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(
        private platform: NodeJS.Platform,
        private swiftVersion: Version
    ) {}

    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        launchConfig: vscode.DebugConfiguration,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        cancellation?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration> {
        launchConfig.env = this.convertEnvironmentVariables(launchConfig.env);
        // Fix the program path on Windows to include the ".exe" extension
        if (this.platform === "win32" && path.extname(launchConfig.program) !== ".exe") {
            launchConfig.program += ".exe";
        }
        // Delegate to CodeLLDB if that's the debug adapter we have selected
        if (DebugAdapter.getDebugAdapterType(this.swiftVersion) === "lldb-vscode") {
            launchConfig.type = "lldb";
            launchConfig.sourceLanguages = ["swift"];
        }
        return launchConfig;
    }

    convertEnvironmentVariables(
        map: { [key: string]: string } | undefined
    ): { [key: string]: string } | string[] | undefined {
        if (map === undefined) {
            return undefined;
        }
        return Object.entries(map).map(([key, value]) => `${key}=${value}`);
    }
}
