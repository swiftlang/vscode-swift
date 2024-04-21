//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import { MarkdownString } from "vscode";

/** Regex for parsing XCTest output */
export interface TestRegex {
    started: RegExp;
    passed: RegExp;
    failed: RegExp;
    error: RegExp;
    skipped: RegExp;
    startedSuite: RegExp;
    passedSuite: RegExp;
    failedSuite: RegExp;
}

/** Regex for parsing darwin XCTest output */
export const darwinTestRegex = {
    // Regex "Test Case '-[<test target> <class.function>]' started"
    started: /^Test Case '-\[(\S+)\s(.*)\]' started./,
    // Regex "Test Case '-[<test target> <class.function>]' passed (<duration> seconds)"
    passed: /^Test Case '-\[(\S+)\s(.*)\]' passed \((\d.*) seconds\)/,
    // Regex "Test Case '-[<test target> <class.function>]' failed (<duration> seconds)"
    failed: /^Test Case '-\[(\S+)\s(.*)\]' failed \((\d.*) seconds\)/,
    // Regex "<path/to/test>:<line number>: error: -[<test target> <class.function>] : <error>"
    error: /^(.+):(\d+):\serror:\s-\[(\S+)\s(.*)\] : (.*)$/,
    // Regex "<path/to/test>:<line number>: -[<test target> <class.function>] : Test skipped"
    skipped: /^(.+):(\d+):\s-\[(\S+)\s(.*)\] : Test skipped/,
    // Regex "Test Suite '-[<test target> <class.function>]' started"
    startedSuite: /^Test Suite '(.*)' started/,
    // Regex "Test Suite '-[<test target> <class.function>]' passed"
    passedSuite: /^Test Suite '(.*)' passed/,
    // Regex "Test Suite '-[<test target> <class.function>]' failed"
    failedSuite: /^Test Suite '(.*)' failed/,
};

/** Regex for parsing non darwin XCTest output */
export const nonDarwinTestRegex = {
    // Regex "Test Case '-[<test target> <class.function>]' started"
    started: /^Test Case '(.*)\.(.*)' started/,
    // Regex "Test Case '<class>.<function>' passed (<duration> seconds)"
    passed: /^Test Case '(.*)\.(.*)' passed \((\d.*) seconds\)/,
    // Regex "Test Case '-[<test target> <class.function>]' failed (<duration> seconds)"
    failed: /^Test Case '(.*)\.(.*)' failed \((\d.*) seconds\)/,
    // Regex "<path/to/test>:<line number>: error: <class>.<function> : <error>"
    error: /^(.+):(\d+):\serror:\s*(.*)\.(.*) : (.*)/,
    // Regex "<path/to/test>:<line number>: <class>.<function> : Test skipped"
    skipped: /^(.+):(\d+):\s*(.*)\.(.*) : Test skipped/,
    // Regex "Test Suite '-[<test target> <class.function>]' started"
    startedSuite: /^Test Suite '(.*)' started/,
    // Regex "Test Suite '-[<test target> <class.function>]' passed"
    passedSuite: /^Test Suite '(.*)' passed/,
    // Regex "Test Suite '-[<test target> <class.function>]' failed"
    failedSuite: /^Test Suite '(.*)' failed/,
};

export class TestOutputParser {
    /**
     * Parse results from `swift test` and update tests accordingly
     * @param output Output from `swift test`
     */
    public parseResult(output: string, runState: iTestRunState, regex: TestRegex) {
        const output2 = output.replace(/\r\n/g, "\n");
        const lines = output2.split("\n");
        if (runState.excess) {
            lines[0] = runState.excess + lines[0];
        }
        // pop empty string off the end of the lines array
        if (lines.length > 0 && lines[lines.length - 1] === "") {
            lines.pop();
        }
        // if submitted text does not end with a newline then pop that off and store in excess
        // for next call of parseResultDarwin
        if (output2[output2.length - 1] !== "\n") {
            runState.excess = lines.pop();
        } else {
            runState.excess = undefined;
        }

        // Non-Darwin test output does not include the test target name. The only way to find out
        // the target for a test is when it fails and returns a file name. If we find failed tests
        // first and then remove them from the list we cannot set them to passed by mistake.
        // We extract the file name from the error and use that to check whether the file belongs
        // to the target associated with the TestItem. This does not work 100% as the error could
        // occur in another target, so we revert to just searching for class and function name if
        // the above method is unsuccessful.
        for (const line of lines) {
            // Regex "Test Case '-[<test target> <class.function>]' started"
            const startedMatch = regex.started.exec(line);
            if (startedMatch) {
                const testName = `${startedMatch[1]}/${startedMatch[2]}`;
                const startedTestIndex = runState.getTestItemIndex(testName, undefined);
                this.startTest(startedTestIndex, runState);
                continue;
            }
            // Regex "Test Case '-[<test target> <class.function>]' failed (<duration> seconds)"
            const failedMatch = regex.failed.exec(line);
            if (failedMatch) {
                const testName = `${failedMatch[1]}/${failedMatch[2]}`;
                const failedTestIndex = runState.getTestItemIndex(testName, undefined);
                this.failTest(failedTestIndex, +failedMatch[3], runState);
                continue;
            }
            // Regex "<path/to/test>:<line number>: error: <class>.<function> : <error>"
            const errorMatch = regex.error.exec(line);
            if (errorMatch) {
                const testName = `${errorMatch[3]}/${errorMatch[4]}`;
                const failedTestIndex = runState.getTestItemIndex(testName, errorMatch[1]);
                this.startErrorMessage(
                    failedTestIndex,
                    errorMatch[5],
                    errorMatch[1],
                    errorMatch[2],
                    runState
                );
                continue;
            }
            // Regex "<path/to/test>:<line number>: <class>.<function> : Test skipped"
            const skippedMatch = regex.skipped.exec(line);
            if (skippedMatch) {
                const testName = `${skippedMatch[3]}/${skippedMatch[4]}`;
                const skippedTestIndex = runState.getTestItemIndex(testName, skippedMatch[1]);
                this.skipTest(skippedTestIndex, runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' started"
            const startedSuiteMatch = regex.startedSuite.exec(line);
            if (startedSuiteMatch) {
                this.startTestSuite(startedSuiteMatch[1], runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' passed"
            const passedSuiteMatch = regex.passedSuite.exec(line);
            if (passedSuiteMatch) {
                this.passTestSuite(passedSuiteMatch[1], runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' failed"
            const failedSuiteMatch = regex.failedSuite.exec(line);
            if (failedSuiteMatch) {
                this.failTestSuite(failedSuiteMatch[1], runState);
                continue;
            }
            // unrecognised output could be the continuation of a previous error message
            this.continueErrorMessage(line, runState);
        }

        // We need to run the passed checks in a separate pass to ensure we aren't in the situation
        // where there is a symbol clash between different test targets and set the wrong test
        // to be passed.
        for (const line of lines) {
            // Regex "Test Case '<class>.<function>' passed (<duration> seconds)"
            const passedMatch = regex.passed.exec(line);
            if (passedMatch) {
                const testName = `${passedMatch[1]}/${passedMatch[2]}`;
                const duration: number = +passedMatch[3];
                const passedTestIndex = runState.getTestItemIndex(testName, undefined);
                this.passTest(passedTestIndex, duration, runState);
                continue;
            }
        }
    }

    /** Flag a test suite has started */
    private startTestSuite(name: string, runState: iTestRunState) {
        runState.startedSuite(name);
    }

    /** Flag a test suite has passed */
    private passTestSuite(name: string, runState: iTestRunState) {
        runState.passedSuite(name);
    }

    /** Flag a test suite has failed */
    private failTestSuite(name: string, runState: iTestRunState) {
        runState.failedSuite(name);
    }

    /** Flag we have started a test */
    private startTest(testIndex: number, runState: iTestRunState) {
        if (testIndex !== -1) {
            runState.started(testIndex);
            // clear error state
            runState.failedTest = undefined;
        }
    }

    /** Flag we have passed a test */
    private passTest(testIndex: number, duration: number, runState: iTestRunState) {
        if (testIndex !== -1) {
            runState.completed(testIndex, duration);
        }
        runState.failedTest = undefined;
    }

    /** Start capture error message */
    private startErrorMessage(
        testIndex: number,
        message: string,
        file: string,
        lineNumber: string,
        runState: iTestRunState
    ) {
        // if we have already found an error then skip this error
        if (runState.failedTest) {
            runState.recordIssue(testIndex, runState.failedTest.message, {
                file: runState.failedTest.file,
                line: runState.failedTest.lineNumber,
            });
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
    private continueErrorMessage(message: string, runState: iTestRunState) {
        // if we have a failed test message and it isn't complete
        if (runState.failedTest && runState.failedTest.complete !== true) {
            runState.failedTest.message += `\n${message}`;
        }
    }

    /** Flag we have failed a test */
    private failTest(testIndex: number, duration: number, runState: iTestRunState) {
        if (testIndex !== -1) {
            if (runState.failedTest) {
                runState.recordIssue(testIndex, runState.failedTest.message, {
                    file: runState.failedTest.file,
                    line: runState.failedTest.lineNumber,
                });
            } else {
                runState.recordIssue(testIndex, "Failed");
            }
        }
        runState.completed(testIndex, duration);
        runState.failedTest = undefined;
    }

    /** Flag we have skipped a test */
    private skipTest(testIndex: number, runState: iTestRunState) {
        if (testIndex !== -1) {
            runState.skipped(testIndex);
        }
        runState.failedTest = undefined;
    }
}

/**
 * Interface for setting this test runs state
 */
export interface iTestRunState {
    // excess data from previous parse that was not processed
    excess?: string;
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
    completed(index: number, durationOrEndTime: number): void;
    // set test index to have failed
    // failed(index: number, message: string, location?: { file: string; line: number }): void;
    recordIssue(
        index: number,
        message: string | MarkdownString,
        location?: { file: string; line: number; column?: number }
    ): void;
    // set test index to have been skipped
    skipped(index: number): void;
    // started suite
    startedSuite(name: string): void;
    // passed suite
    passedSuite(name: string): void;
    // failed suite
    failedSuite(name: string): void;
}
