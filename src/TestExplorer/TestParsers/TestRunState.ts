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
 * Interface for setting this test runs state
 */
export interface ITestRunState {
    // excess data from previous parse that was not processed
    excess?: string;

    // the currently running suite, with the test target included, i.e: TestTarget.Suite
    // note that TestTarget is only present on Darwin.
    activeSuite?: string;

    // output captured before a test has run in a suite
    pendingSuiteOutput?: string[];

    // failed test state
    failedTest?: {
        testIndex: number;
        message: string;
        file: string;
        lineNumber: number;
        complete: boolean;
    };

    // get test item index from test name on non Darwin platforms
    getTestItemIndex(id: string, filename: string | undefined): number;

    // set test index to be started
    started(index: number, startTime?: number): void;

    // set test index to have passed.
    // If a start time was provided to `started` then the duration is computed as endTime - startTime,
    // otherwise the time passed is assumed to be the duration.
    completed(index: number, timing: { duration: number } | { timestamp: number }): void;

    // record an issue against a test.
    // If a `testCase` is provided a new TestItem will be created under the TestItem at the supplied index.
    recordIssue(
        index: number,
        message: string | vscode.MarkdownString,
        isKnown: boolean,
        location?: vscode.Location,
        diff?: TestIssueDiff
    ): void;

    // set test index to have been skipped
    skipped(index: number): void;

    // started suite
    startedSuite(name: string): void;

    // passed suite
    passedSuite(name: string): void;

    // failed suite
    failedSuite(name: string): void;

    // record output to associate with a test
    recordOutput(index: number | undefined, output: string): void;
}

export interface TestIssueDiff {
    expected: string;
    actual: string;
}
