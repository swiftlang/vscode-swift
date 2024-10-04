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
import { DebugAdapter, LaunchConfigType } from "./debugAdapter";
import { Version } from "../utilities/version";

export function registerLLDBDebugAdapter(workspaceContext: WorkspaceContext): vscode.Disposable {
    const debugAdpaterFactory = vscode.debug.registerDebugAdapterDescriptorFactory(
        LaunchConfigType.SWIFT_EXTENSION,
        new LLDBDebugAdapterExecutableFactory(workspaceContext)
    );
    const debugConfigProvider = vscode.debug.registerDebugConfigurationProvider(
        LaunchConfigType.SWIFT_EXTENSION,
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
    private workspaceContext: WorkspaceContext;

    constructor(workspaceContext: WorkspaceContext) {
        this.workspaceContext = workspaceContext;
    }

    createDebugAdapterDescriptor(): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        // Use the stored workspaceContext
        return DebugAdapter.debugAdapterPath(this.workspaceContext.toolchain)
            .then(path =>
                DebugAdapter.verifyDebugAdapterExists(this.workspaceContext).then(() => path)
            )
            .then(path => new vscode.DebugAdapterExecutable(path, [], {}));
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
        private swiftVersion: Version
    ) {}

    async resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        launchConfig: vscode.DebugConfiguration
    ): Promise<vscode.DebugConfiguration> {
        launchConfig.env = this.convertEnvironmentVariables(launchConfig.env);
        // Fix the program path on Windows to include the ".exe" extension
        if (
            this.platform === "win32" &&
            launchConfig.testType === undefined &&
            path.extname(launchConfig.program) !== ".exe"
        ) {
            launchConfig.program += ".exe";
        }

        // Delegate to CodeLLDB if that's the debug adapter we have selected
        if (DebugAdapter.getLaunchConfigType(this.swiftVersion) === LaunchConfigType.CODE_LLDB) {
            launchConfig.type = LaunchConfigType.CODE_LLDB;
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
