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
 * The supported {@link vscode.DebugConfiguration.type Debug Configuration Type} for auto-generation of launch configurations
 */
export const enum LaunchConfigType {
    SWIFT_EXTENSION = "swift-lldb",
    CODE_LLDB = "lldb",
}

/**
 * Class managing which debug adapter we are using. Will only setup lldb-vscode/lldb-dap if it is available.
 */
export class DebugAdapter {
    /**
     * Return the launch configuration type for the given Swift version. This also takes
     * into account user settings when determining which launch configuration to use.
     *
     * @param swiftVersion the version of the Swift toolchain
     * @returns the type of launch configuration used by the given Swift toolchain version
     */
    public static getLaunchConfigType(swiftVersion: Version): LaunchConfigType {
        return swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0)) &&
            configuration.debugger.useDebugAdapterFromToolchain
            ? LaunchConfigType.SWIFT_EXTENSION
            : LaunchConfigType.CODE_LLDB;
    }

    /** Return the path to the debug adapter */
    public static async debugAdapterPath(toolchain: SwiftToolchain): Promise<string> {
        const customDebugAdapterPath = configuration.debugger.customDebugAdapterPath;
        if (customDebugAdapterPath.length > 0) {
            return customDebugAdapterPath;
        }

        const debugAdapter = this.getLaunchConfigType(toolchain.swiftVersion);
        switch (debugAdapter) {
            case LaunchConfigType.SWIFT_EXTENSION:
                return toolchain.getLLDBDebugAdapter();
            case LaunchConfigType.CODE_LLDB:
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
                const debugAdapterName = this.getLaunchConfigType(workspace.toolchain.swiftVersion);
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
