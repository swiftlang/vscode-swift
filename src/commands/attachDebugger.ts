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
import { SWIFT_LAUNCH_CONFIG_TYPE } from "../debugger/debugAdapter";

/**
 * Attaches the LLDB debugger to a running process selected by the user.
 *
 * This function retrieves a list of processes using `getLldbProcess`, then presents
 * a process picker to the user. If the user selects a process, it configures LLDB
 * to attach to that process and starts the debugging session in VS Code.
 *
 * @param {WorkspaceContext} ctx - The workspace context, which provides access to toolchain and configuration details.
 * @returns {Promise<void>} - A promise that resolves when the debugger is successfully attached or the user cancels the operation.
 *
 * @throws Will display an error message if no processes are available, or if the debugger fails to attach to the selected process.
 */
export async function attachDebugger(ctx: WorkspaceContext) {
    await vscode.debug.startDebugging(undefined, {
        type: SWIFT_LAUNCH_CONFIG_TYPE,
        request: "attach",
        name: "Attach",
        pid: "${command:pickProcess}",
    });
}
