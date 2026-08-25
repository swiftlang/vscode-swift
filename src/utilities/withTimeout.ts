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

/** An error that is thrown when an operation exceeds its timeout. */
export class TimeoutError extends Error {
    constructor(message: string, options: ErrorOptions = {}) {
        super(message, options);
        this.name = "TimeoutError";
    }
}

/**
 * Executes the provided task. The promise will be rejected with a {@link TimeoutError} if the time
 * spent exceeds the provided timeout.
 *
 * @param label A description of the operation being performed.
 * @param task The task to execute.
 * @param timeoutMs The timeout in milliseconds.
 */
export function withTimeout<T>(label: string, task: TimeoutTask<T>, timeoutMs: number): Promise<T> {
    // Create the TimeoutError early so that it has a more useful stack trace.
    const timeoutError = new TimeoutError(`${label} timed out after ${timeoutMs}ms.`);
    const cancellation = new vscode.CancellationTokenSource();
    let timeout: NodeJS.Timeout | undefined;
    return Promise.race([
        task(cancellation.token),
        new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
                reject(timeoutError);
                setImmediate(() => cancellation.cancel());
            }, timeoutMs);
        }),
    ]).finally(() => clearTimeout(timeout));
}
