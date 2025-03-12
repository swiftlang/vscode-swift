//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as path from "path";
import * as vscode from "vscode";
import { createProcessList } from "../process-list";

interface ProcessQuickPick extends vscode.QuickPickItem {
    processId?: number;
}

/**
 * Prompts the user to select a running process.
 *
 * The return value must be a string so that it is compatible with VS Code's
 * string substitution infrastructure. The value will eventually be converted
 * to a number by the debug configuration provider.
 *
 * @param configuration The related debug configuration, if any
 * @returns The pid of the process as a string or undefined if cancelled.
 */
export async function pickProcess(
    configuration?: vscode.DebugConfiguration
): Promise<string | undefined> {
    const processList = createProcessList();
    const selectedProcess = await vscode.window.showQuickPick<ProcessQuickPick>(
        processList.listAllProcesses().then((processes): ProcessQuickPick[] => {
            // Sort by start date in descending order
            processes.sort((a, b) => b.start - a.start);
            // Filter by program if requested
            if (typeof configuration?.program === "string") {
                const program = configuration.program;
                const programBaseName = path.basename(program);
                processes = processes
                    .filter(proc => path.basename(proc.command) === programBaseName)
                    .sort((a, b) => {
                        // Bring exact command matches to the top
                        const aIsExactMatch = a.command === program ? 1 : 0;
                        const bIsExactMatch = b.command === program ? 1 : 0;
                        return bIsExactMatch - aIsExactMatch;
                    });
                // Show a better message if all processes were filtered out
                if (processes.length === 0) {
                    return [
                        {
                            label: "No processes matched the debug configuration's program",
                        },
                    ];
                }
            }
            // Convert to a QuickPickItem
            return processes.map(proc => {
                return {
                    processId: proc.id,
                    label: path.basename(proc.command),
                    description: proc.id.toString(),
                    detail: proc.arguments,
                } satisfies ProcessQuickPick;
            });
        }),
        {
            placeHolder: "Select a process to attach the debugger to",
            matchOnDetail: true,
            matchOnDescription: true,
        }
    );
    return selectedProcess?.processId?.toString();
}
