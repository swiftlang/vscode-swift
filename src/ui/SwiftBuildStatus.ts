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

import configuration, { ShowBuildStatusOptions } from "../configuration";
import { SwiftExecution } from "../tasks/SwiftExecution";
import { checkIfBuildComplete, lineBreakRegex } from "../utilities/tasks";
import { RunningTask, StatusItem } from "./StatusItem";

// eslint-disable-next-line @typescript-eslint/no-require-imports
import stripAnsi = require("strip-ansi");

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
        const isBuildTask = task.group === vscode.TaskGroup.Build;
        const disposables: vscode.Disposable[] = [];
        const handleTaskOutput = (
            options: { showProgressStatus: boolean },
            update: (message: string) => void
        ) =>
            new Promise<void>(res => {
                const done = () => {
                    disposables.forEach(d => d.dispose());
                    res();
                };
                disposables.push(
                    this.outputParser(
                        new RunningTask(task).name,
                        execution,
                        isBuildTask,
                        showBuildStatus,
                        options.showProgressStatus,
                        update,
                        done
                    ),
                    execution.onDidClose(done),
                    vscode.tasks.onDidEndTask(e => {
                        if (e.execution.task === task) {
                            done();
                        }
                    })
                );
            });
        if (showBuildStatus === "progress" || showBuildStatus === "notification") {
            void vscode.window.withProgress<void>(
                {
                    location:
                        showBuildStatus === "progress"
                            ? vscode.ProgressLocation.Window
                            : vscode.ProgressLocation.Notification,
                },
                progress =>
                    handleTaskOutput({ showProgressStatus: true }, message =>
                        progress.report({ message })
                    )
            );
        } else {
            void this.statusItem.showStatusWhileRunning(task, () =>
                handleTaskOutput({ showProgressStatus: false }, message =>
                    this.statusItem.update(task, message)
                )
            );
        }
    }

    private outputParser(
        name: string,
        execution: SwiftExecution,
        isBuildTask: boolean,
        showBuildStatus: ShowBuildStatusOptions,
        showProgressStatus: boolean,
        update: (message: string) => void,
        done: () => void
    ): vscode.Disposable {
        let started = false;

        const parseEvents = (data: string) => {
            const sanitizedData = stripAnsi(data);
            // We'll process data one line at a time, in reverse order
            // since the latest interesting message is all we need to
            // be concerned with
            const lines = sanitizedData.split(lineBreakRegex).reverse();
            for (const line of lines) {
                if (checkIfBuildComplete(line)) {
                    update(name);
                    return !isBuildTask;
                }
                const progress = this.findBuildProgress(line);
                if (progress) {
                    update(`${name}: [${progress.completed}/${progress.total}]`);
                    started = true;
                    return false;
                }
                if (this.checkIfFetching(line)) {
                    // this.statusItem.update(task, `Fetching dependencies "${task.name}"`);
                    update(`${name}: Fetching Dependencies`);
                    started = true;
                    return false;
                }
            }
            return false;
        };

        // Begin by showing a message that the build is preparing, as there is sometimes
        // a delay before building starts, especially in large projects.
        if (!started && showBuildStatus !== "never" && showProgressStatus) {
            update(`${name}: Preparing...`);
        }

        return execution.onDidWrite(data => {
            if (parseEvents(data)) {
                done();
            }
        });
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
