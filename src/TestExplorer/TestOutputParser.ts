//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2023 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

export class TestOutputParser {
    /**
     * Parse results from `swift test` and update tests accordingly for Darwin platforms
     * @param output Output from `swift test`
     */
    public parseResultDarwin(output: string, runState: iTestRunState) {
        const lines = output.split("\n");
        if (runState.excess) {
            lines[0] = runState.excess + lines[0];
        }
        if (output[output.length - 1] !== "\n") {
            runState.excess = lines.pop();
        } else {
            runState.excess = undefined;
        }

        for (const line of lines) {
            // Regex "Test Case '-[<test target> <class.function>]' started"
            const startedMatch = /^Test Case '-\[(\S+)\s(.*)\]' started./.exec(line);
            if (startedMatch) {
                const testId = `${startedMatch[1]}/${startedMatch[2]}`;
                this.startTest(runState.getTestItemIndexDarwin(testId), runState);
                continue;
            }
            // Regex "Test Case '-[<test target> <class.function>]' passed (<duration> seconds)"
            const passedMatch = /^Test Case '-\[(\S+)\s(.*)\]' passed \((\d.*) seconds\)/.exec(
                line
            );
            if (passedMatch) {
                const testId = `${passedMatch[1]}/${passedMatch[2]}`;
                const duration: number = +passedMatch[3];
                this.passTest(runState.getTestItemIndexDarwin(testId), duration, runState);
                continue;
            }
            // Regex "Test Case '-[<test target> <class.function>]' failed (<duration> seconds)"
            const failedMatch = /^Test Case '-\[(\S+)\s(.*)\]' failed \((\d.*) seconds\)/.exec(
                line
            );
            if (failedMatch) {
                const testId = `${failedMatch[1]}/${failedMatch[2]}`;
                const duration: number = +failedMatch[3];
                this.failTest(runState.getTestItemIndexDarwin(testId), duration, runState);
                continue;
            }
            // Regex "<path/to/test>:<line number>: error: -[<test target> <class.function>] : <error>"
            const errorMatch = /^(.+):(\d+):\serror:\s-\[(\S+)\s(.*)\] : (.*)$/.exec(line);
            if (errorMatch) {
                const testId = `${errorMatch[3]}/${errorMatch[4]}`;
                this.startErrorMessage(
                    runState.getTestItemIndexDarwin(testId),
                    errorMatch[5],
                    errorMatch[1],
                    errorMatch[2],
                    runState
                );
                continue;
            }
            // Regex "<path/to/test>:<line number>: -[<test target> <class.function>] : Test skipped"
            const skippedMatch = /^(.+):(\d+):\s-\[(\S+)\s(.*)\] : Test skipped/.exec(line);
            if (skippedMatch) {
                const testId = `${skippedMatch[3]}/${skippedMatch[4]}`;
                this.skipTest(runState.getTestItemIndexDarwin(testId), runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' started"
            const startedSuiteMatch = /^Test Suite '(.*)' started/.exec(line);
            if (startedSuiteMatch) {
                this.startTestSuite(startedSuiteMatch[1], runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' passed"
            const passedSuiteMatch = /^Test Suite '(.*)' passed/.exec(line);
            if (passedSuiteMatch) {
                this.passTestSuite(passedSuiteMatch[1], runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' failed"
            const failedSuiteMatch = /^Test Suite '(.*)' failed/.exec(line);
            if (failedSuiteMatch) {
                this.failTestSuite(failedSuiteMatch[1], runState);
                continue;
            }
            // unrecognised output could be the continuation of a previous error message
            this.continueErrorMessage(line, runState);
        }
    }

    /**
     * Parse results from `swift test` and update tests accordingly for non Darwin
     * platforms eg Linux and Windows
     * @param output Output from `swift test`
     */
    public parseResultNonDarwin(output: string, runState: iTestRunState) {
        const lines = output.split("\n");
        if (runState.excess) {
            lines[0] = runState.excess + lines[0];
        }
        if (output[output.length - 1] !== "\n") {
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
            const startedMatch = /^Test Case '(.*)\.(.*)' started/.exec(line);
            if (startedMatch) {
                const testName = `${startedMatch[1]}/${startedMatch[2]}`;
                const startedTestIndex = runState.getTestItemIndexNonDarwin(testName, undefined);
                this.startTest(startedTestIndex, runState);
                continue;
            }
            // Regex "Test Case '-[<test target> <class.function>]' failed (<duration> seconds)"
            const failedMatch = /^Test Case '(.*)\.(.*)' failed \((\d.*) seconds\)/.exec(line);
            if (failedMatch) {
                const testName = `${failedMatch[1]}/${failedMatch[2]}`;
                const failedTestIndex = runState.getTestItemIndexNonDarwin(testName, undefined);
                this.failTest(failedTestIndex, +failedMatch[3], runState);
                continue;
            }
            // Regex "<path/to/test>:<line number>: error: <class>.<function> : <error>"
            const errorMatch = /^(.+):(\d+):\serror:\s*(.*)\.(.*) : (.*)/.exec(line);
            if (errorMatch) {
                const testName = `${errorMatch[3]}/${errorMatch[4]}`;
                const failedTestIndex = runState.getTestItemIndexNonDarwin(testName, errorMatch[1]);
                this.startErrorMessage(
                    failedTestIndex,
                    errorMatch[5],
                    errorMatch[1],
                    errorMatch[2],
                    runState
                );
                continue;
            }
            // Regex "<path/to/test>:<line number>: <class>.<function> : Test skipped:"
            const skippedMatch = /^(.+):(\d+):\s*(.*)\.(.*) : Test skipped:/.exec(line);
            if (skippedMatch) {
                const testName = `${skippedMatch[3]}/${skippedMatch[4]}`;
                const skippedTestIndex = runState.getTestItemIndexNonDarwin(
                    testName,
                    skippedMatch[1]
                );
                this.skipTest(skippedTestIndex, runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' started"
            const startedSuiteMatch = /^Test Suite '(.*)' started/.exec(line);
            if (startedSuiteMatch) {
                this.startTestSuite(startedSuiteMatch[1], runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' passed"
            const passedSuiteMatch = /^Test Suite '(.*)' passed/.exec(line);
            if (passedSuiteMatch) {
                this.passTestSuite(passedSuiteMatch[1], runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' failed"
            const failedSuiteMatch = /^Test Suite '(.*)' failed/.exec(line);
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
            const passedMatch = /^Test Case '(.*)\.(.*)' passed \((\d.*) seconds\)/.exec(line);
            if (passedMatch) {
                const testName = `${passedMatch[1]}/${passedMatch[2]}`;
                const duration: number = +passedMatch[3];
                const passedTestIndex = runState.getTestItemIndexNonDarwin(testName, undefined);
                this.passTest(passedTestIndex, duration, runState);
                continue;
            }
        }
    }

    /** Flag a test suite has started */
    private startTestSuite(name: string, runState: iTestRunState) {
        runState.suiteStack.push(name);
    }

    /** Flag a test suite has passed */
    private passTestSuite(name: string, runState: iTestRunState) {
        runState.suiteStack.pop();
    }

    /** Flag a test suite has failed */
    private failTestSuite(name: string, runState: iTestRunState) {
        runState.suiteStack.pop();
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
            runState.passed(testIndex, duration);
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
            runState.failedTest.complete = true;
            return;
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
                runState.failed(testIndex, runState.failedTest.message, {
                    file: runState.failedTest.file,
                    line: runState.failedTest.lineNumber,
                });
            } else {
                runState.failed(testIndex, "Failed");
            }
        }
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
    // stack of test suites
    suiteStack: string[];
    // failed test state
    failedTest?: {
        testIndex: number;
        message: string;
        file: string;
        lineNumber: number;
        complete: boolean;
    };

    // get test item index from test name on Darwin platforms
    getTestItemIndexDarwin(id: string): number;
    // get test item index from test name on non Darwin platforms
    getTestItemIndexNonDarwin(id: string, filename: string | undefined): number;
    // set test index to be started
    started(index: number): void;
    // set test index to have passed
    passed(index: number, duration: number): void;
    // set test index to have failed
    failed(index: number, message: string, location?: { file: string; line: number }): void;
    // set test index to have been skipped
    skipped(index: number): void;
}
