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

/**
 * A wrapper around {@link vscode.Progress} that allows for delaying progress reporting.
 */
class ProgressWrapper<T> implements vscode.Progress<T> {
    private lastProgressReport: T | undefined;
    private progressReportEmitter: vscode.EventEmitter<T> = new vscode.EventEmitter();

    report(value: T): void {
        this.lastProgressReport = value;
        this.progressReportEmitter.fire(value);
    }

    onDidReportProgress: vscode.Event<T> = listener => {
        if (this.lastProgressReport !== undefined) {
            listener(this.lastProgressReport);
        }
        return this.progressReportEmitter.event(listener);
    };
}

/**
 * A wrapper around {@link vscode.window.withProgress withProgress} that will show progress
 * only after a certain timeout is reached. Useful for user-initiated background
 * tasks that are expected to complete quickly, but should be reported to the user
 * otherwise.
 * @param options A {@link vscode.ProgressOptions ProgressOptions} object to pass to {@link vscode.window.withProgress withProgress}
 * @param task A callback returning a promise. Progress state can be reported with the provided {@link vscode.Progress Progress}-object.
 * @param timeout The delay (in milliseconds) to wait before showing progress
 */
export async function withDelayedProgress<R>(
    options: vscode.ProgressOptions,
    task: (
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ) => Promise<R>,
    timeout: number
): Promise<R> {
    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const progressWrapper = new ProgressWrapper<{ message?: string; increment?: number }>();
    const disposables: vscode.Disposable[] = [cancellationTokenSource];
    const taskPromise = task(progressWrapper, cancellationTokenSource.token);
    // Trigger vscode.window.withProgress() after a delay
    const nodeTimeout = setTimeout(() => {
        vscode.window
            .withProgress(options, async (progress, token) => {
                // Forward progress events
                disposables.push(
                    progressWrapper.onDidReportProgress(value => progress.report(value))
                );
                // Forward cancellation events
                if (token.isCancellationRequested) {
                    cancellationTokenSource.cancel();
                }
                token.onCancellationRequested(() => cancellationTokenSource.cancel());
                // Progress notification will disappear once the task completes
                await taskPromise;
            })
            .then(undefined, () => {
                /* errors will be handled by the await below */
            });
    }, timeout);
    // Make sure the timeout gets cancelled on completion
    disposables.push({
        dispose: () => clearTimeout(nodeTimeout),
    });
    // Wait for task completion and clean up any disposables
    try {
        return await taskPromise;
    } finally {
        for (const disposable of disposables) {
            disposable.dispose();
        }
    }
}
