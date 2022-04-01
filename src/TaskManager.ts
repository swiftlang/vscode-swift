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

export class TaskManager implements vscode.Disposable {
    constructor() {
        this.onDidEndTaskProcessDisposible = vscode.tasks.onDidEndTaskProcess(event => {
            this.observers.forEach(observer => observer(event));
        });
        this.onDidEndTaskDisposible = vscode.tasks.onDidEndTaskProcess(event => {
            this.observers.forEach(observer =>
                observer({ execution: event.execution, exitCode: undefined })
            );
        });
    }

    onDidEndTaskProcess(observer: TaskObserver): vscode.Disposable {
        this.observers.add(observer);
        return {
            dispose: () => {
                this.removeObserver(observer);
            },
        };
    }

    private removeObserver(observer: TaskObserver) {
        this.observers.delete(observer);
    }

    dispose() {
        this.onDidEndTaskDisposible.dispose();
        this.onDidEndTaskProcessDisposible.dispose();
    }

    private observers: Set<TaskObserver> = new Set();
    private onDidEndTaskProcessDisposible: vscode.Disposable;
    private onDidEndTaskDisposible: vscode.Disposable;
}

/** Workspace Folder observer function */
export type TaskObserver = (execution: vscode.TaskProcessEndEvent) => unknown;
