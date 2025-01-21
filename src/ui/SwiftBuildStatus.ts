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

// eslint-disable-next-line @typescript-eslint/no-require-imports
import stripAnsi = require("strip-ansi");
import * as vscode from "vscode";
import configuration, { ShowBuildStatusOptions } from "../configuration";
import { RunningTask, StatusItem } from "./StatusItem";
import { SwiftExecution } from "../tasks/SwiftExecution";
import { checkIfBuildComplete } from "../utilities/tasks";

/**
 * Progress of `swift` build, parsed from the
 * output, ex. `[6/7] Building main.swift`
 */
interface SwiftProgress {
    completed: number;
    total: number;
}

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

    private handleTaskStatus(task: vscode.Task): void {
        // Only care about swift tasks
        if (task.definition.type !== "swift") {
            return;
        }
        // Default to setting if task doesn't overwrite
        const showBuildStatus: ShowBuildStatusOptions =
            task.definition.showBuildStatus || configuration.showBuildStatus;
        if (showBuildStatus === "never") {
            return;
        }

        const execution = task.execution as SwiftExecution;
        const disposables: vscode.Disposable[] = [];
        const handleTaskOutput = (update: (message: string) => void) =>
            new Promise<void>(res => {
                const done = () => {
                    disposables.forEach(d => d.dispose());
                    res();
                };
                const state = { started: false };
                disposables.push(
                    execution.onDidWrite(data => {
                        if (this.parseEvents(task, data, showBuildStatus, update, state)) {
                            done();
                        }
                    }),
                    execution.onDidClose(done),
                    vscode.tasks.onDidEndTask(e => {
                        if (e.execution.task === task) {
                            done();
                        }
                    })
                );
            });
        if (showBuildStatus === "progress" || showBuildStatus === "notification") {
            vscode.window.withProgress<void>(
                {
                    location:
                        showBuildStatus === "progress"
                            ? vscode.ProgressLocation.Window
                            : vscode.ProgressLocation.Notification,
                },
                progress => handleTaskOutput(message => progress.report({ message }))
            );
        } else {
            this.statusItem.showStatusWhileRunning(task, () =>
                handleTaskOutput(message => this.statusItem.update(task, message))
            );
        }
    }

    /**
     * @param data
     * @returns true if done, false otherwise
     */
    private parseEvents(
        task: vscode.Task,
        data: string,
        showBuildStatus: ShowBuildStatusOptions,
        update: (message: string) => void,
        state: { started: boolean }
    ): boolean {
        const name = new RunningTask(task).name;
        const sanitizedData = stripAnsi(data);
        // We'll process data one line at a time, in reverse order
        // since the latest interesting message is all we need to
        // be concerned with
        const lines = sanitizedData.split(/\r\n|\n|\r/gm).reverse();
        for (const line of lines) {
            if (checkIfBuildComplete(line)) {
                return true;
            }
            const progress = this.findBuildProgress(line);
            if (progress) {
                update(`${name}: [${progress.completed}/${progress.total}]`);
                state.started = true;
                return false;
            }
            if (this.checkIfFetching(line)) {
                // this.statusItem.update(task, `Fetching dependencies "${task.name}"`);
                update(`${name}: Fetching Dependencies`);
                state.started = true;
                return false;
            }
        }
        // If we've found nothing that matches a known state then put up a temporary
        // message that we're preparing the build, as there is sometimes a delay before
        // building starts while the build system is preparing, especially in large projects.
        // The status bar has a message immediately, so only show this when using a
        // notification to show progress.
        if (
            !state.started &&
            (showBuildStatus === "notification" || showBuildStatus === "progress")
        ) {
            update(`${name}: Preparing...`);
        }
        return false;
    }

    private checkIfFetching(line: string): boolean {
        const fetchRegex = /^Fetching\s/gm;
        return !!fetchRegex.exec(line);
    }

    private findBuildProgress(line: string): SwiftProgress | undefined {
        const buildingRegex = /^\[(\d+)\/(\d+)\]/g;
        const match = buildingRegex.exec(line);
        if (match) {
            return { completed: parseInt(match[1]), total: parseInt(match[2]) };
        }
    }
}
