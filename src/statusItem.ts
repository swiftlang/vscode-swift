//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from 'vscode';

/**
 * A {@link vscode.StatusBarItem StatusBarItem} to display the status
 * of tasks run by this extension.
 */
class StatusItem {

    private item: vscode.StatusBarItem;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.item.command = `terminal.focus`;
    }

    show(message: string, addProgressIndicator = true) {
        this.item.text = `${addProgressIndicator ? '$(sync~spin) ' : ''}${message}`;
        this.item.show();
    }

    hide() {
        this.item.hide();
    }
    
    dispose() {
        this.item.dispose();
    }
}

/**
 * The global {@link StatusItem} object.
 */
 const statusItem = new StatusItem();
 export default statusItem;
