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

/**
 * Class managing which debug adapter we are using. Will only setup lldb-vscode/lldb-dap if it is available.
 */
export class DebugAdapter {
    private static debugAdapaterExists = false;

    /** Debug adapter name */
    public static get adapterName(): string {
        return configuration.debugger.useDebugAdapterFromToolchain && this.debugAdapaterExists
            ? "swift-lldb"
            : "lldb";
    }

    /** Return debug adapter for toolchain */
    public static getDebugAdapter(swiftVersion: Version): string {
        return swiftVersion.isLessThan(new Version(6, 0, 0)) ? "lldb-vscode" : "lldb-dap";
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
        const useCustom = configuration.debugger.debugAdapterPath.length > 0;
        const debugAdapter = DebugAdapter.getDebugAdapter(workspace.toolchain.swiftVersion);
        const lldbDebugAdapterPath = useCustom
            ? configuration.debugger.debugAdapterPath
            : workspace.toolchain.getToolchainExecutable(debugAdapter);

        if (!(await fileExists(lldbDebugAdapterPath))) {
            if (!quiet) {
                vscode.window.showErrorMessage(
                    useCustom
                        ? `Cannot find ${debugAdapter} debug adapter specified in setting Swift.Debugger.Path.`
                        : `Cannot find ${debugAdapter} debug adapter in your Swift toolchain.`
                );
            }
            workspace.outputChannel.log(`Failed to find ${lldbDebugAdapterPath}`);
            this.debugAdapaterExists = false;
            contextKeys.lldbVSCodeAvailable = false;
            return false;
        }

        this.debugAdapaterExists = true;
        contextKeys.lldbVSCodeAvailable = true;
        return true;
    }
}
