//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";

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
