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

/**
 * Prompts the user to reload the extension in cases where we are unable to do
 * so automatically.
 *
 * @param message the warning message to display to the user
 * @param items extra buttons to display
 * @returns the selected button or undefined if cancelled
 */
export async function showReloadExtensionNotification<T extends string>(
    message: string,
    ...items: T[]
): Promise<"Reload Extensions" | T | undefined> {
    const buttons: ("Reload Extensions" | T)[] = ["Reload Extensions", ...items];
    const selected = await vscode.window.showWarningMessage(message, ...buttons);
    if (selected === "Reload Extensions") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
    return selected;
}
