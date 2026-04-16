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

import { Workbench } from "../utilities/commands";

/**
 * Prompts the user to restart their editor after an installation has been completed.
 *
 * @param type The type of installation that was completed. Changes the displayed message.
 */
export async function promptToRestartAfterInstallation(
    type: "Swiftly" | "toolchain"
): Promise<void> {
    const editorName = vscode.env.appName;
    const selection = await vscode.window.showInformationMessage(
        `Restart ${editorName}`,
        {
            modal: true,
            detail: `You must restart ${editorName} in order for the ${type} installation to take effect.`,
        },
        `Quit ${editorName}`
    );
    if (selection === `Quit ${editorName}`) {
        await vscode.commands.executeCommand(Workbench.ACTION_QUIT);
    }
}
