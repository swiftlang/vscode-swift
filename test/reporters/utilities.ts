//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

/**
 * Attaches the provided array of log messages to a test so they can be
 * retrieved later by a reporter (e.g. to include in a failure summary).
 */
export function attachCapturedLogs(test: Mocha.Runnable, logs: string[]): void {
    (test as any).__VSCode_Swift_capturedLogs = [...logs];
}

/**
 * Retrieves the array of log messages previously attached to a test via
 * {@link attachCapturedLogs}, or `undefined` if none were set.
 */
export function getCapturedLogs(test: Mocha.Runnable): string[] | undefined {
    return (test as any).__VSCode_Swift_capturedLogs;
}
