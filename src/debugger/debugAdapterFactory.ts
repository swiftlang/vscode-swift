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

import * as vscode from "vscode";
import * as fs from "fs";
import { WorkspaceContext } from "../WorkspaceContext";
import { SwiftToolchain } from "../toolchain/toolchain";

export function registerLLDBDebugAdapter(workspaceContext: WorkspaceContext): vscode.Disposable {
    class LLDBDebugAdapterExecutableFactory implements vscode.DebugAdapterDescriptorFactory {
        // The following use of a DebugAdapter factory shows how to control what debug adapter executable is used.
        // Since the code implements the default behavior, it is absolutely not neccessary and we show it here only for educational purpose.

        createDebugAdapterDescriptor(
            _session: vscode.DebugSession,
            executable: vscode.DebugAdapterExecutable | undefined
        ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
            // param "executable" contains the executable optionally specified in the package.json (if any)

            // use the executable specified in the package.json if it exists or determine it based on some other information (e.g. the session)
            if (!executable) {
                executable = new vscode.DebugAdapterExecutable(
                    workspaceContext.toolchain.getToolchainExecutable("lldb-vscode"),
                    [],
                    {}
                );
            }

            // make VS Code launch the DA executable
            return executable;
        }
    }

    const debugAdpaterFactory = vscode.debug.registerDebugAdapterDescriptorFactory(
        "swift-lldb",
        new LLDBDebugAdapterExecutableFactory()
    );
    const debugConfigProvider = vscode.debug.registerDebugConfigurationProvider(
        "swift-lldb",
        new LLDBDebugConfigurationProvider()
    );
    return {
        dispose: () => {
            debugConfigProvider.dispose();
            debugAdpaterFactory.dispose();
        },
    };
}

async function isFileExists(path: string): Promise<boolean> {
    try {
        return (await fs.promises.stat(path)).isFile();
    } catch (e) {
        return false;
    }
}
export async function verifyDebugAdapterExists(toolchain: SwiftToolchain): Promise<boolean> {
    const lldbDebugAdapterPath = toolchain.getToolchainExecutable("lldb-vscode");
    if (!(await isFileExists(lldbDebugAdapterPath))) {
        vscode.window.showInformationMessage(
            "Cannot find lldb-vscode debug adapter in your Swift toolchain."
        );
        return false;
    }
    return true;
}

class LLDBDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        launchConfig: vscode.DebugConfiguration,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        cancellation?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration> {
        launchConfig.env = this.convertEnvironmentVariables(launchConfig.env);
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
