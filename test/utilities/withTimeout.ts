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
 * @param timeoutMs The timeout in milliseconds.
 */
export function withTimeout<T>(task: TimeoutTask<T>, timeoutMs: number): Promise<T> {
    const callSite = Error("withTimeout() was called here:");
    const cancellation = new vscode.CancellationTokenSource();
    let timeout: NodeJS.Timeout | undefined;
    return Promise.race([
        task(cancellation.token),
        new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
                reject(new Error(`Operation timed out after ${timeoutMs}ms`, { cause: callSite }));
                setImmediate(() => cancellation.cancel());
            }, timeoutMs);
        }),
    ]).finally(() => clearTimeout(timeout));
}
