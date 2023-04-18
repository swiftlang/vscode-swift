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

import * as assert from "assert";
import { iTestRunState, TestOutputParser } from "../../src/TestExplorer/TestOutputParser";

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
    duration?: number;
    message?: string;
    location?: { file: string; line: number };
}

/** Test implementation of iTestRunState */
class TestRunState implements iTestRunState {
    excess?: string;
    failedTest?: {
        testIndex: number;
        message: string;
        file: string;
        lineNumber: number;
        complete: boolean;
    };
    tests: TestItem[];
    constructor(testNames: string[]) {
        this.tests = testNames.map(name => {
            return { name: name, status: TestStatus.enqueued };
        });
    }

    getTestItemIndexDarwin(id: string): number {
        return this.tests.findIndex(item => item.name === id);
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getTestItemIndexNonDarwin(id: string, _filename: string | undefined): number {
        const testIndex = this.tests.findIndex(item => item.name.endsWith(id));
        // to properly test Linux we should be checking filenames, but the test framework
        // doesn't have a concept of targets with files in them
        return testIndex;
    }
    started(index: number): void {
        this.tests[index].status = TestStatus.started;
    }
    passed(index: number, duration: number): void {
        this.tests[index].status = TestStatus.passed;
        this.tests[index].duration = duration;
    }
    failed(index: number, message: string, location?: { file: string; line: number }): void {
        this.tests[index].status = TestStatus.failed;
        this.tests[index].message = message;
        this.tests[index].location = location;
    }
    skipped(index: number): void {
        this.tests[index].status = TestStatus.skipped;
    }

    // started suite
    startedSuite(name: string) {
        //
    }
    // started suite
    passedSuite(name: string) {
        //
    }
    // started suite
    failedSuite(name: string) {
        //
    }
}

suite("TestOutputParser Suite", () => {
    const outputParser = new TestOutputParser();

    suite("Darwin", () => {
        test("Passed Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testPass"]);
            const runState = testRunState.tests[0];
            outputParser.parseResultDarwin(
                `Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests testPass]' passed (0.001 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.passed);
            assert.strictEqual(runState.duration, 0.001);
        });

        test("Failed Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"]);
            const runState = testRunState.tests[0];
            outputParser.parseResultDarwin(
                `Test Case '-[MyTests.MyTests testPublish]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : XCTAssertEqual failed: ("1") is not equal to ("2")
Test Case '-[MyTests.MyTests testFail]' failed (0.106 seconds).                
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.failed);
            assert.strictEqual(
                runState.message,
                `XCTAssertEqual failed: ("1") is not equal to ("2")`
            );
            assert.strictEqual(
                runState.location?.file,
                "/Users/user/Developer/MyTests/MyTests.swift"
            );
            assert.strictEqual(runState.location?.line, 59);
        });

        test("Skipped Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testSkip"]);
            const runState = testRunState.tests[0];
            outputParser.parseResultDarwin(
                `Test Case '-[MyTests.MyTests testSkip]' started.
/Users/user/Developer/MyTests/MyTests.swift:90: -[MyTests.MyTests testSkip] : Test skipped
Test Case '-[MyTests.MyTests testSkip]' skipped (0.002 seconds).              
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.skipped);
        });

        test("Multi-line Fail", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"]);
            const runState = testRunState.tests[0];
            outputParser.parseResultDarwin(
                `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : failed - Multiline
fail
message
Test Case '-[MyTests.MyTests testFail]' failed (0.571 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.failed);
            assert.strictEqual(
                runState.message,
                `failed - Multiline
fail
message`
            );
        });

        test("Multi-line Fail followed by another error", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"]);
            const runState = testRunState.tests[0];
            outputParser.parseResultDarwin(
                `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : failed - Multiline
fail
message
/Users/user/Developer/MyTests/MyTests.swift:61: error: -[MyTests.MyTests testFail] : failed - Again
Test Case '-[MyTests.MyTests testFail]' failed (0.571 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.failed);
            assert.strictEqual(
                runState.message,
                `failed - Multiline
fail
message`
            );
        });

        test("Split line", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testPass"]);
            const runState = testRunState.tests[0];
            outputParser.parseResultDarwin(
                `Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests`,
                testRunState
            );
            outputParser.parseResultDarwin(
                ` testPass]' passed (0.006 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.passed);
            assert.strictEqual(runState.duration, 0.006);
        });
    });

    suite("Linux", () => {
        test("Passed Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testPass"]);
            const runState = testRunState.tests[0];
            outputParser.parseResultNonDarwin(
                `Test Case 'MyTests.testPass' started.
Test Case 'MyTests.testPass' passed (0.001 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.passed);
            assert.strictEqual(runState.duration, 0.001);
        });

        test("Failed Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"]);
            const runState = testRunState.tests[0];
            outputParser.parseResultNonDarwin(
                `Test Case 'MyTests.testFail' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: MyTests.testFail : XCTAssertEqual failed: ("1") is not equal to ("2")
Test Case 'MyTests.testFail' failed (0.106 seconds).                
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.failed);
            assert.strictEqual(
                runState.message,
                `XCTAssertEqual failed: ("1") is not equal to ("2")`
            );
            assert.strictEqual(
                runState.location?.file,
                "/Users/user/Developer/MyTests/MyTests.swift"
            );
            assert.strictEqual(runState.location?.line, 59);
        });

        test("Skipped Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testSkip"]);
            const runState = testRunState.tests[0];
            outputParser.parseResultNonDarwin(
                `Test Case 'MyTests.testSkip' started.
/Users/user/Developer/MyTests/MyTests.swift:90: MyTests.testSkip : Test skipped
Test Case 'MyTests.testSkip' skipped (0.002 seconds).              
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.skipped);
        });
    });
});
