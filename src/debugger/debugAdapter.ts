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
import configuration from "../configuration";
import contextKeys from "../contextKeys";
import { fileExists } from "../utilities/filesystem";
import { Version } from "../utilities/version";
import { WorkspaceContext } from "../WorkspaceContext";
import { SwiftToolchain } from "../toolchain/toolchain";

/**
 * Class managing which debug adapter we are using. Will only setup lldb-vscode/lldb-dap if it is available.
 */
export class DebugAdapter {
    /** Debug adapter name */
    public static get adapterName(): string {
        return "swift-lldb";
    }

    /** Return debug adapter for toolchain */
    public static getDebugAdapter(swiftVersion: Version): "lldb-vscode" | "lldb-dap" {
        return configuration.debugger.useCodeLLDB
            ? "lldb-vscode"
            : swiftVersion.isLessThan(new Version(6, 0, 0))
              ? "lldb-vscode"
              : "lldb-dap";
    }

    /** Return the path to the debug adapter */
    public static async debugAdapterPath(toolchain: SwiftToolchain): Promise<string> {
        const customDebugAdapterPath = configuration.debugger.customDebugAdapterPath;
        if (customDebugAdapterPath.length > 0) {
            return customDebugAdapterPath;
        }

        const debugAdapter = this.getDebugAdapter(toolchain.swiftVersion);
        if (process.platform === "darwin" && debugAdapter === "lldb-dap") {
            return await toolchain.getLLDBDebugAdapter();
        } else {
            return toolchain.getToolchainExecutable(debugAdapter);
        }
    }

    /**
     * Verify that the toolchain debug adapter exists
     * @param workspace WorkspaceContext
     * @param quiet Should dialog be displayed
     * @returns Is debugger available
     */
    public static async verifyDebugAdapterExists(
        workspace: WorkspaceContext,
        quiet = false
    ): Promise<boolean> {
        const lldbDebugAdapterPath = await this.debugAdapterPath(workspace.toolchain);

        if (!(await fileExists(lldbDebugAdapterPath))) {
            if (!quiet) {
                const debugAdapterName = this.getDebugAdapter(workspace.toolchain.swiftVersion);
                vscode.window.showErrorMessage(
                    configuration.debugger.customDebugAdapterPath.length > 0
                        ? `Cannot find ${debugAdapterName} debug adapter specified in setting Swift.Debugger.Path.`
                        : `Cannot find ${debugAdapterName} debug adapter in your Swift toolchain.`
                );
            }
            workspace.outputChannel.log(`Failed to find ${lldbDebugAdapterPath}`);
            contextKeys.lldbVSCodeAvailable = false;
            return false;
        }

        contextKeys.lldbVSCodeAvailable = true;
        return true;
    }
}
