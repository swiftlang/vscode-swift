//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";

/**
 * Displays a QuickPick UI with the parameters and passes the result
 * to the provided closure.
 */
export async function withQuickPick<T extends vscode.QuickPickItem>(
    placeholder: string,
    options: T[],
    onSelect: (picked: T) => Promise<void>
) {
    const picker = vscode.window.createQuickPick<T>();

    picker.placeholder = placeholder;
    picker.items = options;

    picker.show();

    const pickedItem = await new Promise<T | undefined>(resolve => {
        picker.onDidAccept(() => resolve(picker.selectedItems[0]));
        picker.onDidHide(() => resolve(undefined));
    });

    picker.busy = true;

    if (pickedItem) {
        await onSelect(pickedItem);
        picker.busy = false;
    }

    picker.dispose();
}
