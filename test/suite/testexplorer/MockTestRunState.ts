import * as vscode from "vscode";
import { ITestRunState } from "../../../src/TestExplorer/TestParsers/TestRunState";

/** TestStatus */
export enum TestStatus {
    enqueued = "enqueued",
    started = "started",
    passed = "passed",
    failed = "failed",
    skipped = "skipped",
}

/** TestItem */
interface TestItem {
    name: string;
    status: TestStatus;
    issues?: { message: string; location?: vscode.Location }[];
    timing?: { duration: number } | { timestamp: number };
}

interface ITestItemFinder {
    getIndex(id: string): number;
    tests: TestItem[];
}

export class DarwinTestItemFinder implements ITestItemFinder {
    constructor(public tests: TestItem[]) {}
    getIndex(id: string): number {
        return this.tests.findIndex(item => item.name === id);
    }
}

export class NonDarwinTestItemFinder implements ITestItemFinder {
    constructor(public tests: TestItem[]) {}
    getIndex(id: string): number {
        return this.tests.findIndex(item => item.name.endsWith(id));
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

    public testItemFinder: ITestItemFinder;

    get tests(): TestItem[] {
        return this.testItemFinder.tests;
    }

    constructor(testNames: string[], darwin: boolean) {
        const tests = testNames.map(name => {
            return { name: name, status: TestStatus.enqueued };
        });
        if (darwin) {
            this.testItemFinder = new DarwinTestItemFinder(tests);
        } else {
            this.testItemFinder = new NonDarwinTestItemFinder(tests);
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

    recordIssue(index: number, message: string, location?: vscode.Location): void {
        this.testItemFinder.tests[index].issues = [
            ...(this.testItemFinder.tests[index].issues ?? []),
            { message, location },
        ];
        this.testItemFinder.tests[index].status = TestStatus.failed;
    }

    skipped(index: number): void {
        this.testItemFinder.tests[index].status = TestStatus.skipped;
    }

    // started suite
    startedSuite() {
        //
    }
    // passed suite
    passedSuite() {
        //
    }
    // failed suite
    failedSuite() {
        //
    }
}
