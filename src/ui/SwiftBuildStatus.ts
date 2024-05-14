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
import configuration from "../configuration";
import { StatusItem } from "./StatusItem";
import { SwiftTask } from "../tasks/SwiftTask";

/**
 * This class will handle detecting and updating the status
 * bar message as the `swift` process executes.
 *
 * @see {@link SwiftExecution} to see what and where the events come from
 */
export class SwiftBuildStatus implements vscode.Disposable {
    private onDidStartTaskDisposible: vscode.Disposable;

    constructor(private statusItem: StatusItem) {
        this.onDidStartTaskDisposible = vscode.tasks.onDidStartTask(event => {
            if (!configuration.showBuildStatus) {
                return;
            }
            this.handleTaskStatus(event.execution.task);
        });
    }

    dispose() {
        this.onDidStartTaskDisposible.dispose();
    }

    private handleTaskStatus(task: vscode.Task) {
        if (!(task instanceof SwiftTask)) {
            return;
        }
        const swiftTask = task as SwiftTask;
        const disposables: vscode.Disposable[] = [];
        this.statusItem.showStatusWhileRunning<void>(
            task,
            () =>
                new Promise<void>(res => {
                    const done = () => {
                        disposables.forEach(d => d.dispose());
                        res();
                    };
                    disposables.push(
                        swiftTask.onBuildComplete(done),
                        swiftTask.onProgress(progress =>
                            this.statusItem.update(
                                task,
                                `Building "${task.name}" (${progress.completed}/${progress.total})`
                            )
                        ),
                        swiftTask.onFetching(() =>
                            this.statusItem.update(task, `Fetching dependencies "${task.name}"`)
                        ),
                        swiftTask.onDidClose(done)
                    );
                })
        );
    }
}
