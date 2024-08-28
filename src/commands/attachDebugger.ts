//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { WorkspaceContext } from "../WorkspaceContext";
import { execFile, getErrorDescription } from "../utilities/utilities";

/**
 * Attach the debugger to a running process.
 */
export async function attachDebugger(ctx: WorkspaceContext) {
    // use LLDB to get list of processes
    const lldb = await ctx.toolchain.getLLDB();
    try {
        const { stdout } = await execFile(lldb, [
            "--batch",
            "--no-lldbinit",
            "--one-line",
            "platform process list --show-args --all-users",
        ]);
        const entries = stdout.split("\n");
        const processPickItems = entries.flatMap(line => {
            const match = /^(\d+)\s+\d+\s+\S+\s+\S+\s+(.+)$/.exec(line);
            if (match) {
                return [{ pid: parseInt(match[1]), label: `${match[1]}: ${match[2]}` }];
            } else {
                return [];
            }
        });
        const picked = await vscode.window.showQuickPick(processPickItems, {
            placeHolder: "Select Process",
        });
        if (picked) {
            const debugConfig: vscode.DebugConfiguration = {
                type: "swift-lldb",
                request: "attach",
                name: "Attach",
                pid: picked.pid,
            };
            await vscode.debug.startDebugging(undefined, debugConfig);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to run LLDB: ${getErrorDescription(error)}`);
    }
}
