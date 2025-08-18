//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { TestRunProxy } from "./TestRunner";
import { FolderContext } from "../FolderContext";

/**
 * Manages active test runs and provides functionality to check if a test run is in progress
 * and to cancel test runs.
 */
export class TestRunManager {
    private activeTestRuns = new Map<
        string,
        { testRun: TestRunProxy; tokenSource: vscode.CancellationTokenSource }
    >();

    /**
     * Register a new test run
     * @param testRun The test run to register
     * @param folder The folder context
     * @param tokenSource The cancellation token source
     */
    public registerTestRun(
        testRun: TestRunProxy,
        folder: FolderContext,
        tokenSource: vscode.CancellationTokenSource
    ) {
        const key = this.getTestRunKey(folder);
        this.activeTestRuns.set(key, { testRun, tokenSource });

        // When the test run completes, remove it from active test runs
        testRun.onTestRunComplete(() => {
            this.activeTestRuns.delete(key);
        });
    }

    /**
     * Cancel an active test run
     * @param folder The folder context
     */
    public cancelTestRun(folder: FolderContext) {
        const key = this.getTestRunKey(folder);
        const activeRun = this.activeTestRuns.get(key);
        if (activeRun) {
            activeRun.testRun.skipPendingTests();
            activeRun.tokenSource.cancel();
        }
    }

    /**
     * Check if a test run is already in progress for the given folder and test kind
     * @param folder The folder context
     * @returns The active test run if one exists, undefined otherwise
     */
    public getActiveTestRun(folder: FolderContext) {
        const key = this.getTestRunKey(folder);
        const activeRun = this.activeTestRuns.get(key);
        return activeRun?.testRun;
    }

    /**
     * Generate a unique key for a test run based on folder and test kind
     * @param folder The folder context
     * @returns A unique key
     */
    private getTestRunKey(folder: FolderContext) {
        return folder.folder.fsPath;
    }
}
