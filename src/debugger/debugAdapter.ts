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
import { FolderContext } from "../FolderContext";

/**
 * Class managing which debug adapter we are using. Will only setup lldb-vscode/lldb-dap if it is available.
 */
export class DebugAdapter {
    /** Debug adapter name */
    public static getAdapterName(
        context: WorkspaceContext | FolderContext | Version
    ): "swift-lldb" | "lldb" {
        return DebugAdapter.getDebugAdapterType(context) === "lldb-dap" ? "swift-lldb" : "lldb";
    }

    /** Return debug adapter for toolchain */
    public static getDebugAdapterType(
        context: WorkspaceContext | FolderContext | Version
    ): "lldb" | "lldb-dap" {
        let swiftVersion: Version;
        if (context instanceof Version) {
            swiftVersion = context;
        } else if (context instanceof FolderContext) {
            swiftVersion = context.workspaceContext.swiftVersion;
        } else {
            swiftVersion = context.swiftVersion;
        }
        return swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0)) &&
            configuration.debugger.useDebugAdapterFromToolchain
            ? "lldb-dap"
            : "lldb";
    }

    /** Return the path to the debug adapter */
    public static async debugAdapterPath(toolchain: SwiftToolchain): Promise<string> {
        const customDebugAdapterPath = configuration.debugger.customDebugAdapterPath;
        if (customDebugAdapterPath.length > 0) {
            return customDebugAdapterPath;
        }

        const debugAdapter = this.getDebugAdapterType(toolchain.swiftVersion);
        if (debugAdapter === "lldb-dap") {
            return toolchain.getLLDBDebugAdapter();
        } else {
            return toolchain.getLLDB();
        }
    }

    /**
     * Verify that the toolchain debug adapter exists and display an error message to the user
     * if it doesn't.
     *
     * Has the side effect of setting the `swift.lldbVSCodeAvailable` context key depending
     * on the result.
     *
     * @param workspace WorkspaceContext
     * @param quiet Whether or not the dialog should be displayed if the adapter does not exist
     * @returns Whether or not the debug adapter exists
     */
    public static async verifyDebugAdapterExists(
        workspace: WorkspaceContext,
        quiet = false
    ): Promise<boolean> {
        const lldbDebugAdapterPath = await this.debugAdapterPath(workspace.toolchain).catch(
            error => {
                workspace.outputChannel.log(error);
                return undefined;
            }
        );

        if (!lldbDebugAdapterPath || !(await fileExists(lldbDebugAdapterPath))) {
            if (!quiet) {
                const debugAdapterName = this.getDebugAdapterType(workspace.toolchain.swiftVersion);
                vscode.window.showErrorMessage(
                    configuration.debugger.customDebugAdapterPath.length > 0
                        ? `Cannot find ${debugAdapterName} debug adapter specified in setting Swift.Debugger.Path.`
                        : `Cannot find ${debugAdapterName} debug adapter in your Swift toolchain.`
                );
            }
            if (lldbDebugAdapterPath) {
                workspace.outputChannel.log(`Failed to find ${lldbDebugAdapterPath}`);
            }
            contextKeys.lldbVSCodeAvailable = false;
            return false;
        }

        contextKeys.lldbVSCodeAvailable = true;
        return true;
    }
}
