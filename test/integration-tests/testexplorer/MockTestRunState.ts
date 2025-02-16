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
import { ITestRunState, TestIssueDiff } from "../../../src/TestExplorer/TestParsers/TestRunState";

/** TestStatus */
export enum TestStatus {
    enqueued = "enqueued",
    started = "started",
    passed = "passed",
    failed = "failed",
    skipped = "skipped",
}

/** TestRunTestItem */
export interface TestRunTestItem {
    name: string;
    status: TestStatus;
    issues?: {
        message: string | vscode.MarkdownString;
        isKnown: boolean;
        location?: vscode.Location;
        diff?: TestIssueDiff;
    }[];
    timing?: { duration: number } | { timestamp: number };
    output: string[];
}

interface ITestItemFinder {
    getIndex(id: string): number;
    tests: TestRunTestItem[];
}

export class DarwinTestItemFinder implements ITestItemFinder {
    tests: TestRunTestItem[] = [];
    getIndex(id: string): number {
        const index = this.tests.findIndex(item => item.name === id);
        if (index === -1) {
            this.tests.push({ name: id, status: TestStatus.enqueued, output: [] });
            return this.tests.length - 1;
        }
        return index;
    }
}

export class NonDarwinTestItemFinder implements ITestItemFinder {
    tests: TestRunTestItem[] = [];
    getIndex(id: string): number {
        const index = this.tests.findIndex(item => item.name.endsWith(id));
        if (index === -1) {
            this.tests.push({ name: id, status: TestStatus.enqueued, output: [] });
            return this.tests.length - 1;
        }
        return index;
    }
}

/** Test implementation of ITestRunState */
export class TestRunState implements ITestRunState {
    excess?: string;
    failedTest?: {
        testIndex: number;
        message: string;
        file: string;
        lineNumber: number;
        complete: boolean;
    };
    allOutput: string[] = [];

    public testItemFinder: ITestItemFinder;

    get tests(): TestRunTestItem[] {
        return this.testItemFinder.tests;
    }

    constructor(darwin: boolean) {
        if (darwin) {
            this.testItemFinder = new DarwinTestItemFinder();
        } else {
            this.testItemFinder = new NonDarwinTestItemFinder();
        }
    }

    getTestItemIndex(id: string): number {
        return this.testItemFinder.getIndex(id);
    }

    started(index: number): void {
        this.testItemFinder.tests[index].status = TestStatus.started;
    }

    completed(index: number, timing: { duration: number } | { timestamp: number }): void {
        this.testItemFinder.tests[index].status =
            this.testItemFinder.tests[index].issues !== undefined
                ? TestStatus.failed
                : TestStatus.passed;
        this.testItemFinder.tests[index].timing = timing;
    }

    recordIssue(
        index: number,
        message: string | vscode.MarkdownString,
        isKnown: boolean,
        location?: vscode.Location,
        diff?: TestIssueDiff
    ): void {
        this.testItemFinder.tests[index].issues = [
            ...(this.testItemFinder.tests[index].issues ?? []),
            { message, location, isKnown, diff },
        ];
        this.testItemFinder.tests[index].status = TestStatus.failed;
    }

    skipped(index: number): void {
        this.testItemFinder.tests[index].status = TestStatus.skipped;
    }

    recordOutput(index: number | undefined, output: string): void {
        if (index !== undefined) {
            this.testItemFinder.tests[index].output.push(output);
        }
        this.allOutput.push(output);
    }

    // started suite
    startedSuite() {
        //
    }
    // passed suite
    passedSuite(name: string) {
        const index = this.testItemFinder.getIndex(name);
        this.testItemFinder.tests[index].status = TestStatus.passed;
    }
    // failed suite
    failedSuite(name: string) {
        const index = this.testItemFinder.getIndex(name);
        this.testItemFinder.tests[index].status = TestStatus.failed;
    }
}
