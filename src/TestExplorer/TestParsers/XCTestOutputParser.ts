//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { Location, MarkdownString } from "vscode";

import { lineBreakRegex } from "../../utilities/tasks";
import { sourceLocationToVSCodeLocation } from "../../utilities/utilities";
import { ITestRunState, TestIssueDiff } from "./TestRunState";

// eslint-disable-next-line @typescript-eslint/no-require-imports
import stripAnsi = require("strip-ansi");

/** Regex for parsing XCTest output */
interface TestRegex {
    started: RegExp;
    finished: RegExp;
    error: RegExp;
    skipped: RegExp;
    startedSuite: RegExp;
    passedSuite: RegExp;
    failedSuite: RegExp;
}

enum TestCompletionState {
    passed = "passed",
    failed = "failed",
    skipped = "skipped",
}

/** Regex for parsing darwin XCTest output */
export const darwinTestRegex = {
    // Regex "Test Case '-[<test target> <class.function>]' started"
    started: /Test Case '-\[(\S+)\s(.*)\]' started\./,
    // Regex "Test Case '-[<test target> <class.function>]' <completion_state> (<duration> seconds)"
    finished: /Test Case '-\[(\S+)\s(.*)\]' (.*) \((\d.*) seconds\)/,
    // Regex "<path/to/test>:<line number>: error: -[<test target> <class.function>] : <error>"
    error: /(.+):(\d+):\serror:\s-\[(\S+)\s(.*)\] : (.*)$/,
    // Regex "<path/to/test>:<line number>: -[<test target> <class.function>] : Test skipped"
    skipped: /(.+):(\d+):\s-\[(\S+)\s(.*)\] : Test skipped/,
    // Regex "Test Suite '<class>' started"
    startedSuite: /Test Suite '(.*)' started/,
    // Regex "Test Suite '<class>' passed"
    passedSuite: /Test Suite '(.*)' passed/,
    // Regex "Test Suite '<class>' failed"
    failedSuite: /Test Suite '(.*)' failed/,
};

/** Regex for parsing non darwin XCTest output */
export const nonDarwinTestRegex = {
    // Regex "Test Case '-[<test target> <class.function>]' started"
    started: /Test Case '(.*)\.(.*)' started/,
    // Regex "Test Case '<class>.<function>' <completion_state> (<duration> seconds)"
    finished: /Test Case '(.*)\.(.*)' (.*) \((\d.*) seconds\)/,
    // Regex "<path/to/test>:<line number>: error: <class>.<function> : <error>"
    error: /(.+):(\d+):\serror:\s*(.*)\.(.*) : (.*)/,
    // Regex "<path/to/test>:<line number>: <class>.<function> : Test skipped"
    skipped: /(.+):(\d+):\s*(.*)\.(.*) : Test skipped/,
    // Regex "Test Suite '<class>' started"
    startedSuite: /Test Suite '(.*)' started/,
    // Regex "Test Suite '<class>' passed"
    passedSuite: /Test Suite '(.*)' passed/,
    // Regex "Test Suite '<class>' failed"
    failedSuite: /Test Suite '(.*)' failed/,
};

export interface IXCTestOutputParser {
    parseResult(output: string, runState: ITestRunState): void;
}

export class ParallelXCTestOutputParser implements IXCTestOutputParser {
    private outputParser: XCTestOutputParser;

    /**
     * Create an ParallelXCTestOutputParser.
     * Optional regex can be supplied for tests.
     */
    constructor(
        private hasMultiLineParallelTestOutput: boolean,
        regex?: TestRegex
    ) {
        this.outputParser = new XCTestOutputParser(regex);
    }

    public parseResult(output: string, runState: ITestRunState) {
        // From 5.7 to 5.10 running with the --parallel option dumps the test results out
        // to the console with no newlines, so it isn't possible to distinguish where errors
        // begin and end. Consequently we can't record them. For these versions we rely on the
        // generated xunit XML, which we can parse and mark tests as passed or failed here with
        // manufactured issues.
        // Don't attempt to parse the console output of parallel tests between 5.7 and 5.10
        // as it doesn't have newlines. You might get lucky and find the output is split
        // in the right spot, but more often than not we wont be able to parse it.
        if (!this.hasMultiLineParallelTestOutput) {
            return;
        }

        // For parallel XCTest runs we get pass/fail results from the xunit XML
        // produced at the end of the run, but we still want to monitor the output
        // for the individual assertion failures. Wrap the run state and only forward
        // along the issues captured during a test run, and let the `TestXUnitParser`
        // handle marking tests as completed.
        this.outputParser.parseResult(output, new ParallelXCTestRunStateProxy(runState));
    }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
class ParallelXCTestRunStateProxy implements ITestRunState {
    // Note this must remain stateless as its recreated on
    // every `parseResult` call in `ParallelXCTestOutputParser`
    constructor(private runState: ITestRunState) {}

    get excess(): typeof this.runState.excess {
        return this.runState.excess;
    }

    set excess(value: typeof this.runState.excess) {
        this.runState.excess = value;
    }

    get activeSuite(): typeof this.runState.activeSuite {
        return this.runState.activeSuite;
    }

    set activeSuite(value: typeof this.runState.activeSuite) {
        this.runState.activeSuite = value;
    }

    get pendingSuiteOutput(): typeof this.runState.pendingSuiteOutput {
        return this.runState.pendingSuiteOutput;
    }

    set pendingSuiteOutput(value: typeof this.runState.pendingSuiteOutput) {
        this.runState.pendingSuiteOutput = value;
    }

    get failedTest(): typeof this.runState.failedTest {
        return this.runState.failedTest;
    }

    set failedTest(value: typeof this.runState.failedTest) {
        this.runState.failedTest = value;
    }

    getTestItemIndex(id: string, filename: string | undefined): number {
        return this.runState.getTestItemIndex(id, filename);
    }
    recordIssue(
        index: number,
        message: string | MarkdownString,
        isKnown: boolean = false,
        location?: Location | undefined
    ): void {
        this.runState.recordIssue(index, message, isKnown, location);
    }
    started(index: number, startTime?: number | undefined): void {}
    completed(index: number, timing: { duration: number } | { timestamp: number }): void {}
    skipped(index: number): void {}
    startedSuite(name: string): void {}
    passedSuite(name: string): void {}
    failedSuite(name: string): void {}
    recordOutput(index: number | undefined, output: string): void {}
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export class XCTestOutputParser implements IXCTestOutputParser {
    private regex: TestRegex;

    /**
     * Create an XCTestOutputParser.
     * Optional regex can be supplied for tests.
     */
    constructor(regex?: TestRegex) {
        this.regex = regex ?? this.platformTestRegex;
    }

    /**
     * Parse results from `swift test` and update tests accordingly
     * @param output Output from `swift test`
     */
    public parseResult(rawOutput: string, runState: ITestRunState) {
        const lines = this.prepareOutputLines(rawOutput, runState);

        for (const line of lines) {
            const handled =
                this.handleTestStarted(line, runState) ||
                this.handleTestFinished(line, runState) ||
                this.handleTestError(line, runState) ||
                this.handleTestSkipped(line, runState) ||
                this.handleSuiteStarted(line, runState) ||
                this.handleSuitePassed(line, runState) ||
                this.handleSuiteFailed(line, runState);

            if (!handled) {
                this.continueErrorMessage(line, runState);
            }
        }
    }

    private prepareOutputLines(rawOutput: string, runState: ITestRunState): string[] {
        const output = process.platform === "win32" ? stripAnsi(rawOutput) : rawOutput;
        const normalized = output.replace(/\r\n/g, "\n");
        const lines = normalized.split(lineBreakRegex);

        if (runState.excess) {
            lines[0] = runState.excess + lines[0];
        }
        if (lines.length > 0 && lines[lines.length - 1] === "") {
            lines.pop();
        }
        if (normalized[normalized.length - 1] !== "\n") {
            runState.excess = lines.pop();
        } else {
            runState.excess = undefined;
        }

        return lines;
    }

    private handleTestStarted(line: string, runState: ITestRunState): boolean {
        const match = this.regex.started.exec(line);
        if (!match) {
            return false;
        }

        const testName = `${match[1]}/${match[2]}`;
        runState.activeSuite = match[1];
        this.processPendingSuiteOutput(runState, match[1]);

        const testIndex = runState.getTestItemIndex(testName, undefined);
        this.startTest(testIndex, runState);
        this.appendTestOutput(testIndex, line, runState);
        return true;
    }

    private handleTestFinished(line: string, runState: ITestRunState): boolean {
        const match = this.regex.finished.exec(line);
        if (!match) {
            return false;
        }

        const testName = `${match[1]}/${match[2]}`;
        const testIndex = runState.getTestItemIndex(testName, undefined);
        const state = match[3] as TestCompletionState;
        const duration = +match[4];

        this.applyTestCompletionState(testIndex, state, duration, runState);
        this.appendTestOutput(testIndex, line, runState);
        return true;
    }

    private applyTestCompletionState(
        testIndex: number,
        state: TestCompletionState,
        duration: number,
        runState: ITestRunState
    ) {
        switch (state) {
            case TestCompletionState.failed:
                this.failTest(testIndex, { duration }, runState);
                break;
            case TestCompletionState.passed:
                this.passTest(testIndex, { duration }, runState);
                break;
            case TestCompletionState.skipped:
                this.skipTest(testIndex, runState);
                break;
        }
    }

    private handleTestError(line: string, runState: ITestRunState): boolean {
        const match = this.regex.error.exec(line);
        if (!match) {
            return false;
        }

        const testName = `${match[3]}/${match[4]}`;
        const testIndex = runState.getTestItemIndex(testName, match[1]);
        this.startErrorMessage(testIndex, match[5], match[1], match[2], runState);
        this.appendTestOutput(testIndex, line, runState);
        return true;
    }

    private handleTestSkipped(line: string, runState: ITestRunState): boolean {
        const match = this.regex.skipped.exec(line);
        if (!match) {
            return false;
        }

        const testName = `${match[3]}/${match[4]}`;
        const testIndex = runState.getTestItemIndex(testName, match[1]);
        this.skipTest(testIndex, runState);
        this.appendTestOutput(testIndex, line, runState);
        return true;
    }

    private handleSuiteStarted(line: string, runState: ITestRunState): boolean {
        const match = this.regex.startedSuite.exec(line);
        if (!match) {
            return false;
        }

        this.startTestSuite(match[1], line, runState);
        return true;
    }

    private handleSuitePassed(line: string, runState: ITestRunState): boolean {
        const match = this.regex.passedSuite.exec(line);
        if (!match) {
            return false;
        }

        this.completeSuite(runState, line, this.passTestSuite);
        return true;
    }

    private handleSuiteFailed(line: string, runState: ITestRunState): boolean {
        const match = this.regex.failedSuite.exec(line);
        if (!match) {
            return false;
        }

        this.completeSuite(runState, line, this.failTestSuite);
        return true;
    }

    /**
     * Process the buffered lines captured before a test case has started.
     */
    private processPendingSuiteOutput(runState: ITestRunState, suite?: string) {
        // If we have a qualified suite name captured from a runninng test
        // process the lines captured before the test started, associating the
        // line line with the suite.
        if (runState.pendingSuiteOutput) {
            const startedSuiteIndex = suite ? runState.getTestItemIndex(suite, undefined) : -1;
            const totalLines = runState.pendingSuiteOutput.length - 1;
            for (let i = 0; i <= totalLines; i++) {
                const line = runState.pendingSuiteOutput[i];

                // Only the last line of the captured output should be associated with the suite
                const associateLineWithSuite = i === totalLines && startedSuiteIndex !== -1;

                this.appendTestOutput(
                    associateLineWithSuite ? startedSuiteIndex : undefined,
                    line,
                    runState
                );
            }
            runState.pendingSuiteOutput = [];
        }
    }

    /** Mark a suite as complete */
    private completeSuite(
        runState: ITestRunState,
        line: string,
        resultMethod: (name: string, runState: ITestRunState) => void
    ) {
        let suiteIndex: number | undefined;
        if (runState.activeSuite) {
            resultMethod(runState.activeSuite, runState);
            suiteIndex = runState.getTestItemIndex(runState.activeSuite, undefined);
        }

        // If no tests have run we may have output still in the buffer.
        // If activeSuite is undefined we finished an empty suite
        // and we still want to flush the buffer.
        this.processPendingSuiteOutput(runState, runState.activeSuite);

        runState.activeSuite = undefined;
        this.appendTestOutput(suiteIndex, line, runState);
    }

    /** Get Test parsing regex for current platform */
    private get platformTestRegex(): TestRegex {
        return process.platform === "darwin" ? darwinTestRegex : nonDarwinTestRegex;
    }

    /** Flag a test suite has started */
    private startTestSuite(name: string, line: string, runState: ITestRunState) {
        // Buffer the output to this point until the first test
        // starts, at which point we can determine the target.
        runState.pendingSuiteOutput = runState.pendingSuiteOutput
            ? [...runState.pendingSuiteOutput, line]
            : [line];

        runState.startedSuite(name);
    }

    /** Flag a test suite has passed */
    private passTestSuite(name: string, runState: ITestRunState) {
        runState.passedSuite(name);
    }

    /** Flag a test suite has failed */
    private failTestSuite(name: string, runState: ITestRunState) {
        runState.failedSuite(name);
    }

    /** Flag we have started a test */
    private startTest(testIndex: number, runState: ITestRunState) {
        runState.started(testIndex);
        // clear error state
        runState.failedTest = undefined;
    }

    /** Flag we have passed a test */
    private passTest(
        testIndex: number,
        timing: { duration: number } | { timestamp: number },
        runState: ITestRunState
    ) {
        runState.completed(testIndex, timing);
        runState.failedTest = undefined;
    }

    /** Start capture error message */
    private startErrorMessage(
        testIndex: number,
        message: string,
        file: string,
        lineNumber: string,
        runState: ITestRunState
    ) {
        // If we were already capturing an error record it and start a new one
        if (runState.failedTest) {
            const location = sourceLocationToVSCodeLocation(
                runState.failedTest.file,
                runState.failedTest.lineNumber
            );
            runState.recordIssue(testIndex, runState.failedTest.message, false, location);
            runState.failedTest.complete = true;
        }
        runState.failedTest = {
            testIndex: testIndex,
            message: message,
            file: file,
            lineNumber: parseInt(lineNumber),
            complete: false,
        };
    }

    /** continue capturing error message */
    private continueErrorMessage(message: string, runState: ITestRunState) {
        // if we have a failed test message and it isn't complete
        if (runState.failedTest && runState.failedTest.complete !== true) {
            runState.failedTest.message += `\n${message}`;
            this.appendTestOutput(runState.failedTest.testIndex, message, runState);
        } else {
            this.appendTestOutput(undefined, message, runState);
        }
    }

    /** Flag we have failed a test */
    private failTest(
        testIndex: number,
        timing: { duration: number } | { timestamp: number },
        runState: ITestRunState
    ) {
        if (runState.failedTest) {
            const location = sourceLocationToVSCodeLocation(
                runState.failedTest.file,
                runState.failedTest.lineNumber
            );
            const message = runState.failedTest.message;
            const diff = this.extractDiff(message);
            runState.recordIssue(testIndex, message, false, location, diff);
        } else {
            runState.recordIssue(testIndex, "Failed", false);
        }
        runState.completed(testIndex, timing);
        runState.failedTest = undefined;
    }

    /** Flag we have skipped a test */
    private skipTest(testIndex: number, runState: ITestRunState) {
        runState.skipped(testIndex);
        runState.failedTest = undefined;
    }

    private appendTestOutput(testIndex: number | undefined, line: string, runState: ITestRunState) {
        // Need to add back in the newlines since output was split for parsing.
        runState.recordOutput(testIndex, `${line}\r\n`);
    }

    private extractDiff(message: string): TestIssueDiff | undefined {
        const regex = /\((.*)\) is not .* to \((.*)\)/ms;
        const match = regex.exec(message);
        if (match && match[1] !== match[2]) {
            return {
                actual: match[1],
                expected: match[2],
            };
        }

        return undefined;
    }
}
