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
import { beforeEach } from "mocha";
import {
    darwinTestRegex,
    nonDarwinTestRegex,
    XCTestOutputParser,
} from "../../../src/TestExplorer/TestParsers/XCTestOutputParser";
import { TestRunState, TestStatus } from "./MockTestRunState";
import { sourceLocationToVSCodeLocation } from "../../../src/utilities/utilities";

suite("XCTestOutputParser Suite", () => {
    const inputToTestOutput = (input: string) =>
        input
            .split("\n")
            .slice(0, -1)
            .map(line => `${line}\r\n`);

    suite("Darwin", () => {
        let outputParser: XCTestOutputParser;
        beforeEach(() => {
            outputParser = new XCTestOutputParser(darwinTestRegex);
        });

        test("Passed Test", () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testPass"], true);
            const input = `Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests testPass]' passed (0.001 seconds).
`;
            outputParser.parseResult(input, testRunState);

            assert.deepEqual(testRunState.tests, [
                {
                    name: "MyTests.MyTests/testPass",
                    status: TestStatus.passed,
                    timing: { duration: 0.001 },
                    output: inputToTestOutput(input),
                },
            ]);
        });

        test("Captures logs", () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testPass"], true);
            const input = `Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests testPass]' passed (0.001 seconds).`;
            outputParser.parseResult(input, testRunState);

            assert.deepEqual(outputParser.logs, [input]);
        });

        test("Multiple Passed Tests", () => {
            const testRunState = new TestRunState(
                ["MyTests.MyTests/testPass", "MyTests.MyTests/testPass2"],
                true
            );
            const test1Input = `Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests testPass]' passed (0.001 seconds).
`;
            const test2Input = `Test Case '-[MyTests.MyTests testPass2]' started.
Test Case '-[MyTests.MyTests testPass2]' passed (0.001 seconds).
`;
            const input = `${test1Input}${test2Input}`;

            outputParser.parseResult(input, testRunState);

            assert.deepEqual(testRunState.tests, [
                {
                    name: "MyTests.MyTests/testPass",
                    status: TestStatus.passed,
                    timing: { duration: 0.001 },
                    output: inputToTestOutput(test1Input),
                },
                {
                    name: "MyTests.MyTests/testPass2",
                    status: TestStatus.passed,
                    timing: { duration: 0.001 },
                    output: inputToTestOutput(test2Input),
                },
            ]);
        });

        test("Failed Test", () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"], true);
            const input = `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : XCTAssertEqual failed: ("1") is not equal to ("2")
Test Case '-[MyTests.MyTests testFail]' failed (0.106 seconds).
`;
            const runState = testRunState.tests[0];
            outputParser.parseResult(input, testRunState);

            assert.deepEqual(runState, {
                name: "MyTests.MyTests/testFail",
                status: TestStatus.failed,
                timing: { duration: 0.106 },
                issues: [
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
                ],
                output: inputToTestOutput(input),
            });
        });

        test("Skipped Test", () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testSkip"], true);
            const input = `Test Case '-[MyTests.MyTests testSkip]' started.
/Users/user/Developer/MyTests/MyTests.swift:90: -[MyTests.MyTests testSkip] : Test skipped
Test Case '-[MyTests.MyTests testSkip]' skipped (0.002 seconds).
`;

            const runState = testRunState.tests[0];
            outputParser.parseResult(input, testRunState);

            assert.deepEqual(runState, {
                name: "MyTests.MyTests/testSkip",
                status: TestStatus.skipped,
                output: inputToTestOutput(input),
            });
        });

        test("Multi-line Fail", () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"], true);
            const input = `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : failed - Multiline
fail
message
Test Case '-[MyTests.MyTests testFail]' failed (0.571 seconds).
`;
            const runState = testRunState.tests[0];
            outputParser.parseResult(input, testRunState);

            assert.deepEqual(runState, {
                name: "MyTests.MyTests/testFail",
                status: TestStatus.failed,
                timing: { duration: 0.571 },
                issues: [
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
                ],
                output: inputToTestOutput(input),
            });
        });

        test("Multi-line Fail followed by another error", () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"], true);
            const input = `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : failed - Multiline
fail
message
/Users/user/Developer/MyTests/MyTests.swift:61: error: -[MyTests.MyTests testFail] : failed - Again
Test Case '-[MyTests.MyTests testFail]' failed (0.571 seconds).
`;
            const runState = testRunState.tests[0];
            outputParser.parseResult(input, testRunState);

            assert.deepEqual(runState, {
                name: "MyTests.MyTests/testFail",
                status: TestStatus.failed,
                timing: { duration: 0.571 },
                issues: [
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
                ],
                output: inputToTestOutput(input),
            });
        });

        test("Single-line Fail followed by another error", () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"], true);
            const input = `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : failed - Message
/Users/user/Developer/MyTests/MyTests.swift:61: error: -[MyTests.MyTests testFail] : failed - Again
Test Case '-[MyTests.MyTests testFail]' failed (0.571 seconds).
`;
            const runState = testRunState.tests[0];
            outputParser.parseResult(input, testRunState);

            assert.deepEqual(runState, {
                name: "MyTests.MyTests/testFail",
                status: TestStatus.failed,
                timing: { duration: 0.571 },
                issues: [
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
                ],
                output: inputToTestOutput(input),
            });
        });

        test("Split line", () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testPass"], true);
            const input1 = `Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests`;
            const input2 = ` testPass]' passed (0.006 seconds).
`;
            const runState = testRunState.tests[0];
            outputParser.parseResult(input1, testRunState);
            outputParser.parseResult(input2, testRunState);

            assert.deepEqual(runState, {
                name: "MyTests.MyTests/testPass",
                status: TestStatus.passed,
                timing: { duration: 0.006 },
                output: inputToTestOutput(input1 + input2),
            });
        });

        test("Suite", () => {
            const testRunState = new TestRunState(["MyTests", "MyTests.MyTests/testPass"], true);
            const input = `Test Suite 'MyTests' started at 2024-08-26 13:19:25.325.
Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests testPass]' passed (0.001 seconds).
Test Suite 'MyTests' passed at 2024-08-26 13:19:25.328.
         Executed 1 test, with 0 failures (0 unexpected) in 0.001 (0.001) seconds
`;
            outputParser.parseResult(input, testRunState);

            assert.deepEqual(testRunState.tests, [
                {
                    name: "MyTests",
                    output: [],
                    status: TestStatus.passed,
                },
                {
                    name: "MyTests.MyTests/testPass",
                    status: TestStatus.passed,
                    timing: { duration: 0.001 },
                    output: inputToTestOutput(input).slice(1, -2), // trim the suite text
                },
            ]);
        });

        suite("Diffs", () => {
            const testRun = (message: string, expected?: string, actual?: string) => {
                const testRunState = new TestRunState(["MyTests.MyTests/testFail"], true);
                const input = `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : ${message}
Test Case '-[MyTests.MyTests testFail]' failed (0.106 seconds).
`;
                const runState = testRunState.tests[0];
                outputParser.parseResult(input, testRunState);

                assert.deepEqual(runState, {
                    name: "MyTests.MyTests/testFail",
                    status: TestStatus.failed,
                    timing: { duration: 0.106 },
                    issues: [
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
                    ],
                    output: inputToTestOutput(input),
                });
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

        test("Passed Test", () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testPass"], false);
            const input = `Test Case 'MyTests.testPass' started.
Test Case 'MyTests.testPass' passed (0.001 seconds).
`;
            const runState = testRunState.tests[0];
            outputParser.parseResult(input, testRunState);

            assert.deepEqual(runState, {
                name: "MyTests.MyTests/testPass",
                status: TestStatus.passed,
                timing: { duration: 0.001 },
                output: inputToTestOutput(input),
            });
        });

        test("Failed Test", () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testFail"], false);
            const input = `Test Case 'MyTests.testFail' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: MyTests.testFail : XCTAssertEqual failed: ("1") is not equal to ("2")
Test Case 'MyTests.testFail' failed (0.106 seconds).
`;
            const runState = testRunState.tests[0];
            outputParser.parseResult(input, testRunState);

            assert.deepEqual(runState, {
                name: "MyTests.MyTests/testFail",
                status: TestStatus.failed,
                timing: { duration: 0.106 },
                issues: [
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
                ],
                output: inputToTestOutput(input),
            });
        });

        test("Skipped Test", () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testSkip"], false);
            const input = `Test Case 'MyTests.testSkip' started.
/Users/user/Developer/MyTests/MyTests.swift:90: MyTests.testSkip : Test skipped
Test Case 'MyTests.testSkip' skipped (0.002 seconds).
`;
            const runState = testRunState.tests[0];
            outputParser.parseResult(input, testRunState);

            assert.deepEqual(runState, {
                name: "MyTests.MyTests/testSkip",
                status: TestStatus.skipped,
                output: inputToTestOutput(input),
            });
        });
    });
});
