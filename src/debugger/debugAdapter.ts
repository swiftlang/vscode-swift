//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2023 the VSCode Swift project authors
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
import configuration from "../configuration";

export class DebugAdapter {
    static debugAdapaterExists = false;

    /** Debug adapter name */
    static get adapterName(): string {
        return configuration.debugger.useDebugAdapterFromToolchain && this.debugAdapaterExists
            ? "swift-lldb"
            : "lldb";
    }

    static async verifyDebugAdapterExists(workspace: WorkspaceContext): Promise<boolean> {
        if (configuration.debugger.debugAdapterPath.length > 0) {
            const lldbDebugAdapterPath = configuration.debugger.debugAdapterPath;
            if (!(await this.doesFileExist(lldbDebugAdapterPath))) {
                vscode.window.showInformationMessage(
                    "Cannot find lldb-vscode debug adapter specified in setting Swift.Debugger.Path."
                );
                workspace.outputChannel.log(`Failed to find ${lldbDebugAdapterPath}`);
                this.debugAdapaterExists = false;
                return false;
            }
        } else {
            const lldbDebugAdapterPath = workspace.toolchain.getToolchainExecutable("lldb-vscode");
            if (!(await this.doesFileExist(lldbDebugAdapterPath))) {
                vscode.window.showInformationMessage(
                    "Cannot find lldb-vscode debug adapter in your Swift toolchain."
                );
                workspace.outputChannel.log(`Failed to find ${lldbDebugAdapterPath}`);
                this.debugAdapaterExists = false;
                return false;
            }
        }
        this.debugAdapaterExists = true;
        return true;
    }

    private static async doesFileExist(path: string): Promise<boolean> {
        try {
            return (await fs.promises.stat(path)).isFile();
        } catch (e) {
            return false;
        }
    }
}
