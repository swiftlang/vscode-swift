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

import { Workbench } from "../utilities/commands";

// eslint-disable-next-line @typescript-eslint/no-require-imports
import debounce = require("lodash.debounce");

/**
 * Prompts the user to reload the extension in cases where we are unable to do
 * so automatically. Only one of these prompts will be shown at a time.
 *
 * @param message the warning message to display to the user
 * @param items extra buttons to display
 * @returns the selected button or undefined if cancelled
 */
export function showReloadExtensionNotificationInstance<T extends string>() {
    let inFlight: Promise<"Reload Extensions" | T | undefined> | null = null;

    return async function (
        message: string,
        ...items: T[]
    ): Promise<"Reload Extensions" | T | undefined> {
        if (inFlight) {
            return inFlight;
        }

        const buttons: ("Reload Extensions" | T)[] = ["Reload Extensions", ...items];
        inFlight = (async () => {
            try {
                const selected = await vscode.window.showWarningMessage(message, ...buttons);
                if (selected === "Reload Extensions") {
                    await vscode.commands.executeCommand(Workbench.ACTION_RELOADWINDOW);
                }
                return selected;
            } finally {
                inFlight = null;
            }
        })();

        return inFlight;
    };
}

// In case the user closes the dialog immediately we want to debounce showing it again
// for 10 seconds to prevent another popup perhaps immediately appearing.
export const showReloadExtensionNotification = debounce(
    showReloadExtensionNotificationInstance(),
    10_000,
    { leading: true }
);
