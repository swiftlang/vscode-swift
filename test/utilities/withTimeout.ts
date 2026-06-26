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

export type TimeoutTask<T> = (token: vscode.CancellationToken) => Promise<T>;

/**
 * Executes the provided task. The promise will be rejected if the time spent exceeds the provided timeout.
 *
 * @param task The task to execute.
 * @param timeout The timeout in milliseconds.
 */
export function withTimeout<T>(task: TimeoutTask<T>, timeout: number): Promise<T> {
    const cancellation = new vscode.CancellationTokenSource();
    return Promise.race([
        task(cancellation.token),
        new Promise<never>((_resolve, reject) =>
            setTimeout(() => {
                reject(new Error(`Operation timed out after ${timeout}ms`));
                setImmediate(() => cancellation.cancel());
            }, timeout)
        ),
    ]);
}
