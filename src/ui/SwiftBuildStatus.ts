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
import { Disposable } from "../utilities/Disposable";
import { checkIfBuildComplete, lineBreakRegex } from "../utilities/tasks";
import { StatusItem } from "./StatusItem";

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
export class SwiftBuildStatus implements Disposable {
    private onDidStartTaskDisposible: Disposable;
    private lockedRegex = /Another instance of SwiftPM \(PID: \d+\) is already running/g;
    private debt = 0;

    constructor() {
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
        const handleTaskOutput = (
            update: (report: { message: string; increment?: number }) => void
        ) => this.awaitTaskCompletion(task, execution, isBuildTask, showBuildStatus, update);
        const location =
            showBuildStatus === "notification"
                ? vscode.ProgressLocation.Notification
                : vscode.ProgressLocation.Window;
        void vscode.window.withProgress<void>({ location }, progress =>
            handleTaskOutput(report => progress.report(report))
        );
    }

    private awaitTaskCompletion(
        task: vscode.Task,
        execution: SwiftExecution,
        isBuildTask: boolean,
        showBuildStatus: ShowBuildStatusOptions,
        update: (report: { message: string; increment?: number }) => void
    ): Promise<void> {
        const disposables: Disposable[] = [];
        return new Promise<void>(res => {
            const done = () => {
                disposables.forEach(d => d.dispose());
                res();
            };
            disposables.push(
                this.outputParser(
                    StatusItem.statusItemTaskName(task),
                    execution,
                    isBuildTask,
                    showBuildStatus,
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
    }

    private outputParser(
        name: string,
        execution: SwiftExecution,
        isBuildTask: boolean,
        showBuildStatus: ShowBuildStatusOptions,
        update: (report: { message: string; increment?: number }) => void,
        done: () => void
    ): Disposable {
        let started = false;
        let lastPercentage = 0;

        const parseEvents = (data: string) => {
            const sanitizedData = stripAnsi(data);
            // We'll process data one line at a time, in reverse order
            // since the latest interesting message is all we need to
            // be concerned with
            const lines = sanitizedData.split(lineBreakRegex).reverse();
            for (const line of lines) {
                const lockedFolderPID = this.checkIfBuildFolderLocked(line);
                if (lockedFolderPID > 0) {
                    update({
                        message: `${name}: Build folder locked by pid ${lockedFolderPID}. Wait for this process to complete, or terminate it to continue.`,
                    });
                }
                if (checkIfBuildComplete(line)) {
                    update({ message: name });
                    return !isBuildTask;
                }
                const progress = this.findBuildProgress(line);
                if (progress) {
                    started = true;

                    const percentage = Math.floor((progress.completed / progress.total) * 100);
                    const increment = percentage - lastPercentage;
                    const reportedIncrement = this.applyDebt(increment);

                    lastPercentage = percentage;
                    update({
                        message: `${name}: [${progress.completed}/${progress.total}]`,
                        increment: reportedIncrement,
                    });
                    return false;
                }
                if (this.checkIfFetching(line)) {
                    update({ message: `${name}: Fetching Dependencies` });
                    started = true;
                    return false;
                }
            }
            return false;
        };

        // Begin by showing a message that the build is preparing, as there is sometimes
        // a delay before building starts, especially in large projects.
        if (!started && showBuildStatus !== "never") {
            update({ message: `${name}: Preparing...` });
        }

        return execution.onDidWrite(data => {
            if (parseEvents(data)) {
                done();
            }
        });
    }

    private checkIfBuildFolderLocked(line: string): number {
        const match = this.lockedRegex.exec(line);
        if (match) {
            const pidRegex = /\d+/;
            const pidMatch = pidRegex.exec(match[0]);
            if (pidMatch) {
                return parseInt(pidMatch[0]);
            }
        }
        return 0;
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

    private applyDebt(increment: number): number {
        if (increment < 0) {
            this.debt += Math.abs(increment);
            return 0;
        }
        if (this.debt <= 0) {
            return increment;
        }
        if (increment <= this.debt) {
            this.debt -= increment;
            return 0;
        }
        const result = increment - this.debt;
        this.debt = 0;
        return result;
    }
}
