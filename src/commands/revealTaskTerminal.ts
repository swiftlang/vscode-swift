//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as vscode from "vscode";

import { findTaskTerminal } from "../utilities/tasks";

/**
 * Reveals the terminal hosting a running task, falling back to the running-tasks picker.
 */
export function revealTaskTerminal(task?: vscode.Task): void {
    const terminal = task ? findTaskTerminal(task) : undefined;
    if (terminal) {
        terminal.show();
    } else {
        void vscode.commands.executeCommand("workbench.action.tasks.showTasks");
    }
}
