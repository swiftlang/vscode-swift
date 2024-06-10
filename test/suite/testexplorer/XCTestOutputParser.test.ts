//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import {
    darwinTestRegex,
    nonDarwinTestRegex,
    XCTestOutputParser,
} from "../../../src/TestExplorer/TestParsers/XCTestOutputParser";
import { TestRunState, TestStatus } from "./MockTestRunState";
import { sourceLocationToVSCodeLocation } from "../../../src/utilities/utilities";

suite("XCTestOutputParser Suite", () => {
    suite("Darwin", () => {
        const outputParser = new XCTestOutputParser(darwinTestRegex);

        test("Passed Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testPass"], true);
            const runState = testRunState.tests[0];
            outputParser.parseResult(
                `Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests testPass]' passed (0.001 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.passed);
            assert.deepEqual(runState.timing, { duration: 0.001 });
        });

        test("Failed Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"], true);
            const runState = testRunState.tests[0];
            outputParser.parseResult(
                `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : XCTAssertEqual failed: ("1") is not equal to ("2")
Test Case '-[MyTests.MyTests testFail]' failed (0.106 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.failed);
            assert.deepEqual(runState.issues, [
                {
                    message: `XCTAssertEqual failed: ("1") is not equal to ("2")`,
                    location: sourceLocationToVSCodeLocation(
                        "/Users/user/Developer/MyTests/MyTests.swift",
                        59,
                        0
                    ),
                    isKnown: false,
                    diff: {
                        expected: '"1"',
                        actual: '"2"',
                    },
                },
            ]);
        });

        test("Skipped Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testSkip"], true);
            const runState = testRunState.tests[0];
            outputParser.parseResult(
                `Test Case '-[MyTests.MyTests testSkip]' started.
/Users/user/Developer/MyTests/MyTests.swift:90: -[MyTests.MyTests testSkip] : Test skipped
Test Case '-[MyTests.MyTests testSkip]' skipped (0.002 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.skipped);
        });

        test("Multi-line Fail", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"], true);
            const runState = testRunState.tests[0];
            outputParser.parseResult(
                `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : failed - Multiline
fail
message
Test Case '-[MyTests.MyTests testFail]' failed (0.571 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.failed);
            assert.deepEqual(runState.issues, [
                {
                    message: `failed - Multiline
fail
message`,
                    location: sourceLocationToVSCodeLocation(
                        "/Users/user/Developer/MyTests/MyTests.swift",
                        59,
                        0
                    ),
                    isKnown: false,
                    diff: undefined,
                },
            ]);
        });

        test("Multi-line Fail followed by another error", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"], true);
            const runState = testRunState.tests[0];
            outputParser.parseResult(
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
            assert.deepEqual(runState.issues, [
                {
                    message: `failed - Multiline
fail
message`,
                    location: sourceLocationToVSCodeLocation(
                        "/Users/user/Developer/MyTests/MyTests.swift",
                        59,
                        0
                    ),
                    isKnown: false,
                    diff: undefined,
                },
                {
                    message: `failed - Again`,
                    location: sourceLocationToVSCodeLocation(
                        "/Users/user/Developer/MyTests/MyTests.swift",
                        61,
                        0
                    ),
                    isKnown: false,
                    diff: undefined,
                },
            ]);
        });

        test("Single-line Fail followed by another error", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"], true);
            const runState = testRunState.tests[0];
            outputParser.parseResult(
                `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : failed - Message
/Users/user/Developer/MyTests/MyTests.swift:61: error: -[MyTests.MyTests testFail] : failed - Again
Test Case '-[MyTests.MyTests testFail]' failed (0.571 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.failed);
            assert.deepEqual(runState.issues, [
                {
                    message: `failed - Message`,
                    location: sourceLocationToVSCodeLocation(
                        "/Users/user/Developer/MyTests/MyTests.swift",
                        59,
                        0
                    ),
                    isKnown: false,
                    diff: undefined,
                },
                {
                    message: `failed - Again`,
                    location: sourceLocationToVSCodeLocation(
                        "/Users/user/Developer/MyTests/MyTests.swift",
                        61,
                        0
                    ),
                    isKnown: false,
                    diff: undefined,
                },
            ]);
        });

        test("Split line", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testPass"], true);
            const runState = testRunState.tests[0];
            outputParser.parseResult(
                `Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests`,
                testRunState
            );
            outputParser.parseResult(
                ` testPass]' passed (0.006 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.passed);
            assert.deepEqual(runState.timing, { duration: 0.006 });
        });

        suite("Diffs", () => {
            const testRun = (message: string, expected?: string, actual?: string) => {
                const testRunState = new TestRunState(["MyTests.MyTests/testFail"], true);
                const runState = testRunState.tests[0];
                outputParser.parseResult(
                    `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : ${message}
Test Case '-[MyTests.MyTests testFail]' failed (0.106 seconds).
`,
                    testRunState
                );

                assert.strictEqual(runState.status, TestStatus.failed);
                assert.deepEqual(runState.issues, [
                    {
                        message,
                        location: sourceLocationToVSCodeLocation(
                            "/Users/user/Developer/MyTests/MyTests.swift",
                            59,
                            0
                        ),
                        isKnown: false,
                        diff:
                            expected && actual
                                ? {
                                      expected,
                                      actual,
                                  }
                                : undefined,
                    },
                ]);
            };

            test("XCTAssertEqual", () => {
                testRun(`XCTAssertEqual failed: ("1") is not equal to ("2")`, '"1"', '"2"');
            });
            test("XCTAssertEqualMultiline", () => {
                testRun(
                    `XCTAssertEqual failed: ("foo\nbar") is not equal to ("foo\nbaz")`,
                    '"foo\nbar"',
                    '"foo\nbaz"'
                );
            });
            test("XCTAssertIdentical", () => {
                testRun(
                    `XCTAssertIdentical failed: ("V: 1") is not identical to ("V: 2")`,
                    '"V: 1"',
                    '"V: 2"'
                );
            });
            test("XCTAssertIdentical with Identical Strings", () => {
                testRun(`XCTAssertIdentical failed: ("V: 1") is not identical to ("V: 1")`);
            });
        });
    });

    suite("Linux", () => {
        const outputParser = new XCTestOutputParser(nonDarwinTestRegex);

        test("Passed Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testPass"], false);
            const runState = testRunState.tests[0];
            outputParser.parseResult(
                `Test Case 'MyTests.testPass' started.
Test Case 'MyTests.testPass' passed (0.001 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.passed);
            assert.deepEqual(runState.timing, { duration: 0.001 });
        });

        test("Failed Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"], false);
            const runState = testRunState.tests[0];
            outputParser.parseResult(
                `Test Case 'MyTests.testFail' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: MyTests.testFail : XCTAssertEqual failed: ("1") is not equal to ("2")
Test Case 'MyTests.testFail' failed (0.106 seconds).
`,
                testRunState
            );
            assert.strictEqual(runState.status, TestStatus.failed);
            assert.deepEqual(runState.issues, [
                {
                    message: `XCTAssertEqual failed: ("1") is not equal to ("2")`,
                    location: sourceLocationToVSCodeLocation(
                        "/Users/user/Developer/MyTests/MyTests.swift",
                        59,
                        0
                    ),
                    isKnown: false,
                    diff: {
                        expected: '"1"',
                        actual: '"2"',
                    },
                },
            ]);
        });

        test("Skipped Test", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testSkip"], false);
            const runState = testRunState.tests[0];
            outputParser.parseResult(
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
