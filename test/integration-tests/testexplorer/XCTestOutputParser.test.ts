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
import { TestRunState, TestRunTestItem, TestStatus } from "./MockTestRunState";
import { sourceLocationToVSCodeLocation } from "../../../src/utilities/utilities";
import { TestXUnitParser } from "../../../src/TestExplorer/TestXUnitParser";
import { activateExtensionForSuite } from "../utilities/testutilities";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";
import { lineBreakRegex } from "../../../src/utilities/tasks";

enum ParserTestKind {
    Regular = "Regular Test Run",
    Parallel = "Parallel Test Run",
}

suite("XCTestOutputParser Suite", () => {
    function inputToTestOutput(input: string) {
        return input
            .split(lineBreakRegex)
            .slice(0, -1)
            .map(line => `${line}\r\n`);
    }

    function expectedStateToXML(tests: TestRunTestItem[]) {
        const extractClassName = (name: string) => {
            const parts = name.split("/");
            return parts[0];
        };
        const extractName = (name: string) => {
            const parts = name.split("/");
            return parts[parts.length - 1];
        };
        const extractTiming = (test: TestRunTestItem) => {
            if (test.timing) {
                const time =
                    "duration" in test.timing ? test.timing.duration : test.timing.timestamp;
                return `time="${time}"`;
            }
            return "";
        };
        const extractFailures = (test: TestRunTestItem[]) => {
            return test.reduce((acc, t) => acc + ((t.issues?.length ?? 0) > 0 ? 1 : 0), 0);
        };
        return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
<testsuite name="TestResults" errors="0" tests="${tests.length}" failures="${extractFailures(tests)}" time="0.0">
${tests.map(
    t =>
        `<testcase classname="${extractClassName(t.name)}" name="${extractName(t.name)}" ${extractTiming(t)}>${(t.issues ?? []).map(() => `\n<failure message="failed"></failure>`).join("\n")}</testcase>`
)}
</testsuite>
</testsuites>
</xml>`;
    }

    let hasMultiLineParallelTestOutput: boolean;
    activateExtensionForSuite({
        async setup(ctx) {
            hasMultiLineParallelTestOutput = ctx.globalToolchain.hasMultiLineParallelTestOutput;
        },
    });

    [ParserTestKind.Regular, ParserTestKind.Parallel].forEach(parserTestKind => {
        function assertTestRunState(testRunState: TestRunState, expected: TestRunTestItem[]) {
            // When parsing the results of a parallel test run the TestXUnitParser runs on the
            // generated XML results after the test run is completed to fill out the state with
            // anything that couldn't be captured off the output stream.
            if (parserTestKind === ParserTestKind.Parallel) {
                const xmlResults = expectedStateToXML(expected);
                const xmlParser = new TestXUnitParser(hasMultiLineParallelTestOutput);
                xmlParser.parse(xmlResults, testRunState, new SwiftOutputChannel("test"));
            }

            assert.deepEqual(testRunState.tests, expected);
        }

        suite(`${parserTestKind}`, () => {
            suite("Darwin", () => {
                let outputParser: XCTestOutputParser;
                let testRunState: TestRunState;
                beforeEach(() => {
                    outputParser = new XCTestOutputParser(darwinTestRegex);
                    testRunState = new TestRunState(true);
                });

                test("Passed Test", () => {
                    const input = `Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests testPass]' passed (0.001 seconds).
`;
                    outputParser.parseResult(input, testRunState);

                    assertTestRunState(testRunState, [
                        {
                            name: "MyTests.MyTests/testPass",
                            status: TestStatus.passed,
                            timing: { duration: 0.001 },
                            output: inputToTestOutput(input),
                        },
                    ]);
                });

                test("Multiple Passed Tests", () => {
                    const test1Input = `Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests testPass]' passed (0.001 seconds).
`;
                    const test2Input = `Test Case '-[MyTests.MyTests testPass2]' started.
Test Case '-[MyTests.MyTests testPass2]' passed (0.001 seconds).
`;
                    const input = `${test1Input}${test2Input}`;

                    outputParser.parseResult(input, testRunState);

                    assertTestRunState(testRunState, [
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
                    const input = `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : XCTAssertEqual failed: ("1") is not equal to ("2")
Test Case '-[MyTests.MyTests testFail]' failed (0.106 seconds).
`;
                    outputParser.parseResult(input, testRunState);

                    assertTestRunState(testRunState, [
                        {
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
                                        actual: '"1"',
                                        expected: '"2"',
                                    },
                                },
                            ],
                            output: inputToTestOutput(input),
                        },
                    ]);
                });

                test("Skipped Test", () => {
                    const input = `Test Case '-[MyTests.MyTests testSkip]' started.
/Users/user/Developer/MyTests/MyTests.swift:90: -[MyTests.MyTests testSkip] : Test skipped
Test Case '-[MyTests.MyTests testSkip]' skipped (0.002 seconds).
`;

                    outputParser.parseResult(input, testRunState);

                    assertTestRunState(testRunState, [
                        {
                            name: "MyTests.MyTests/testSkip",
                            status: TestStatus.skipped,
                            output: inputToTestOutput(input),
                        },
                    ]);
                });

                test("Multi-line Fail", () => {
                    const input = `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : failed - Multiline
fail
message
Test Case '-[MyTests.MyTests testFail]' failed (0.571 seconds).
`;
                    outputParser.parseResult(input, testRunState);

                    assertTestRunState(testRunState, [
                        {
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
                        },
                    ]);
                });

                test("Multi-line Fail followed by another error", () => {
                    const input = `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : failed - Multiline
fail
message
/Users/user/Developer/MyTests/MyTests.swift:61: error: -[MyTests.MyTests testFail] : failed - Again
Test Case '-[MyTests.MyTests testFail]' failed (0.571 seconds).
`;
                    outputParser.parseResult(input, testRunState);

                    assertTestRunState(testRunState, [
                        {
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
                        },
                    ]);
                });

                test("Single-line Fail followed by another error", () => {
                    const input = `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : failed - Message
/Users/user/Developer/MyTests/MyTests.swift:61: error: -[MyTests.MyTests testFail] : failed - Again
Test Case '-[MyTests.MyTests testFail]' failed (0.571 seconds).
`;
                    outputParser.parseResult(input, testRunState);

                    assertTestRunState(testRunState, [
                        {
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
                        },
                    ]);
                });

                test("Split line", () => {
                    const input1 = `Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests`;
                    const input2 = ` testPass]' passed (0.006 seconds).
`;
                    outputParser.parseResult(input1, testRunState);
                    outputParser.parseResult(input2, testRunState);

                    assertTestRunState(testRunState, [
                        {
                            name: "MyTests.MyTests/testPass",
                            status: TestStatus.passed,
                            timing: { duration: 0.006 },
                            output: inputToTestOutput(input1 + input2),
                        },
                    ]);
                });

                test("Suite", () => {
                    const input = `Test Suite 'MyTests' started at 2024-08-26 13:19:25.325.
Test Case '-[MyTests.MyTests testPass]' started.
Test Case '-[MyTests.MyTests testPass]' passed (0.001 seconds).
Test Suite 'MyTests' passed at 2024-08-26 13:19:25.328.
            Executed 1 test, with 0 failures (0 unexpected) in 0.001 (0.001) seconds
`;
                    outputParser.parseResult(input, testRunState);

                    const testOutput = inputToTestOutput(input);
                    assertTestRunState(testRunState, [
                        {
                            name: "MyTests.MyTests",
                            output: [testOutput[0], testOutput[3]],
                            status: TestStatus.passed,
                        },
                        {
                            name: "MyTests.MyTests/testPass",
                            status: TestStatus.passed,
                            timing: { duration: 0.001 },
                            output: [testOutput[1], testOutput[2]],
                        },
                    ]);
                    assert.deepEqual(inputToTestOutput(input), testRunState.allOutput);
                });

                test("Empty Suite", () => {
                    const input = `Test Suite 'Selected tests' started at 2024-10-19 15:23:29.594.
Test Suite 'EmptyAppPackageTests.xctest' started at 2024-10-19 15:23:29.595.
Test Suite 'EmptyAppPackageTests.xctest' passed at 2024-10-19 15:23:29.595.
        Executed 0 tests, with 0 failures (0 unexpected) in 0.000 (0.000) seconds
Test Suite 'Selected tests' passed at 2024-10-19 15:23:29.596.
        Executed 0 tests, with 0 failures (0 unexpected) in 0.000 (0.001) seconds
warning: No matching test cases were run`;

                    outputParser.parseResult(input, testRunState);

                    assertTestRunState(testRunState, []);
                    assert.deepEqual(inputToTestOutput(input), testRunState.allOutput);
                });

                test("Multiple Suites", () => {
                    const input = `Test Suite 'All tests' started at 2024-10-20 21:54:32.568.
Test Suite 'EmptyAppPackageTests.xctest' started at 2024-10-20 21:54:32.570.
Test Suite 'TestSuite1' started at 2024-10-20 21:54:32.570.
Test Case '-[MyTests.TestSuite1 testFirst]' started.
Test Case '-[MyTests.TestSuite1 testFirst]' passed (0.000 seconds).
Test Suite 'TestSuite1' passed at 2024-10-20 21:54:32.570.
            Executed 1 test, with 0 failures (0 unexpected) in 0.000 (0.001) seconds
Test Suite 'TestSuite2' started at 2024-10-20 21:54:32.570.
Test Case '-[MyTests.TestSuite2 testSecond]' started.
Test Case '-[MyTests.TestSuite2 testSecond]' passed (0.000 seconds).
Test Suite 'TestSuite2' passed at 2024-10-20 21:54:32.571.
            Executed 1 test, with 0 failures (0 unexpected) in 0.000 (0.000) seconds
Test Suite 'EmptyAppPackageTests.xctest' passed at 2024-10-20 21:54:32.571.
            Executed 2 tests, with 0 failures (0 unexpected) in 0.001 (0.001) seconds
Test Suite 'All tests' passed at 2024-10-20 21:54:32.571.
            Executed 2 tests, with 0 failures (0 unexpected) in 0.001 (0.002) seconds`;

                    outputParser.parseResult(input, testRunState);

                    const testOutput = inputToTestOutput(input);
                    assertTestRunState(testRunState, [
                        {
                            name: "MyTests.TestSuite1",
                            output: [testOutput[2], testOutput[5]],
                            status: TestStatus.passed,
                        },
                        {
                            name: "MyTests.TestSuite1/testFirst",
                            output: [testOutput[3], testOutput[4]],
                            status: TestStatus.passed,
                            timing: {
                                duration: 0,
                            },
                        },
                        {
                            name: "MyTests.TestSuite2",
                            output: [testOutput[7], testOutput[10]],
                            status: TestStatus.passed,
                        },
                        {
                            name: "MyTests.TestSuite2/testSecond",
                            output: [testOutput[8], testOutput[9]],
                            status: TestStatus.passed,
                            timing: {
                                duration: 0,
                            },
                        },
                    ]);
                    assert.deepEqual(inputToTestOutput(input), testRunState.allOutput);
                });

                test("Multiple Suites with Failed Test", () => {
                    const input = `Test Suite 'Selected tests' started at 2024-10-20 22:01:46.206.
Test Suite 'EmptyAppPackageTests.xctest' started at 2024-10-20 22:01:46.207.
Test Suite 'TestSuite1' started at 2024-10-20 22:01:46.207.
Test Case '-[MyTests.TestSuite1 testFirst]' started.
Test Case '-[MyTests.TestSuite1 testFirst]' passed (0.000 seconds).
Test Suite 'TestSuite1' passed at 2024-10-20 22:01:46.208.
            Executed 1 test, with 0 failures (0 unexpected) in 0.000 (0.000) seconds
Test Suite 'TestSuite2' started at 2024-10-20 22:01:46.208.
Test Case '-[MyTests.TestSuite2 testSecond]' started.
/Users/user/Developer/MyTests/MyTests.swift:13: error: -[MyTests.TestSuite2 testSecond] : failed
Test Case '-[MyTests.TestSuite2 testSecond]' failed (0.000 seconds).
Test Suite 'TestSuite2' failed at 2024-10-20 22:01:46.306.
            Executed 1 test, with 1 failure (0 unexpected) in 0.000 (0.000) seconds
Test Suite 'EmptyAppPackageTests.xctest' failed at 2024-10-20 22:01:46.306.
            Executed 2 tests, with 1 failure (0 unexpected) in 0.001 (0.001) seconds
Test Suite 'Selected tests' failed at 2024-10-20 22:01:46.306.
            Executed 2 tests, with 1 failure (0 unexpected) in 0.002 (0.002) seconds`;
                    outputParser.parseResult(input, testRunState);

                    const testOutput = inputToTestOutput(input);
                    assertTestRunState(testRunState, [
                        {
                            name: "MyTests.TestSuite1",
                            output: [testOutput[2], testOutput[5]],
                            status: TestStatus.passed,
                        },
                        {
                            name: "MyTests.TestSuite1/testFirst",
                            output: [testOutput[3], testOutput[4]],
                            status: TestStatus.passed,
                            timing: {
                                duration: 0,
                            },
                        },
                        {
                            name: "MyTests.TestSuite2",
                            output: [testOutput[7], testOutput[11]],
                            status: TestStatus.failed,
                        },
                        {
                            name: "MyTests.TestSuite2/testSecond",
                            output: [testOutput[8], testOutput[9], testOutput[10]],
                            status: TestStatus.failed,
                            timing: {
                                duration: 0,
                            },
                            issues: [
                                {
                                    message: "failed",
                                    location: sourceLocationToVSCodeLocation(
                                        "/Users/user/Developer/MyTests/MyTests.swift",
                                        13,
                                        0
                                    ),
                                    isKnown: false,
                                    diff: undefined,
                                },
                            ],
                        },
                    ]);
                    assert.deepEqual(inputToTestOutput(input), testRunState.allOutput);
                });

                test("Interleaved user and XCTest output", () => {
                    const input = `Test Suite 'Selected tests' started at 2024-10-20 22:01:46.206.
Test Suite 'EmptyAppPackageTests.xctest' started at 2024-10-20 22:01:46.207.
Test Suite 'TestSuite1' started at 2024-10-20 22:01:46.207.
Test Case '-[MyTests.TestSuite1 testFirst]' started.
[debug]: evaluating manifest for 'pkg' v. unknown
[debug]: loading manifeTest Case '-[MyTests.TestSuite1 testFirst]' passed (0.001 seconds).
Test Suite 'TestSuite1' passed at 2024-10-20 22:01:46.208.
    Executed 1 test, with 0 failures (0 unexpected) in 0.000 (0.000) seconds`;

                    outputParser.parseResult(input, testRunState);

                    const testOutput = inputToTestOutput(input);
                    assertTestRunState(testRunState, [
                        {
                            name: "MyTests.TestSuite1",
                            output: [testOutput[2], testOutput[6]],
                            status: TestStatus.passed,
                        },
                        {
                            name: "MyTests.TestSuite1/testFirst",
                            output: [testOutput[3], testOutput[5]],
                            status: TestStatus.passed,
                            timing: {
                                duration: 0.001,
                            },
                        },
                    ]);
                    assert.deepEqual(inputToTestOutput(input), testRunState.allOutput);
                });

                suite("Diffs", () => {
                    const testRun = (message: string, actual?: string, expected?: string) => {
                        const input = `Test Case '-[MyTests.MyTests testFail]' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: -[MyTests.MyTests testFail] : ${message}
Test Case '-[MyTests.MyTests testFail]' failed (0.106 seconds).
`;
                        outputParser.parseResult(input, testRunState);

                        assertTestRunState(testRunState, [
                            {
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
                let outputParser: XCTestOutputParser;
                let testRunState: TestRunState;
                beforeEach(() => {
                    outputParser = new XCTestOutputParser(nonDarwinTestRegex);
                    testRunState = new TestRunState(false);
                });

                test("Passed Test", () => {
                    const input = `Test Case 'MyTests.testPass' started.
Test Case 'MyTests.testPass' passed (0.001 seconds).
`;
                    outputParser.parseResult(input, testRunState);

                    assertTestRunState(testRunState, [
                        {
                            name: "MyTests/testPass",
                            status: TestStatus.passed,
                            timing: { duration: 0.001 },
                            output: inputToTestOutput(input),
                        },
                    ]);
                });

                test("Failed Test", () => {
                    const input = `Test Case 'MyTests.testFail' started.
/Users/user/Developer/MyTests/MyTests.swift:59: error: MyTests.testFail : XCTAssertEqual failed: ("1") is not equal to ("2")
Test Case 'MyTests.testFail' failed (0.106 seconds).
`;
                    outputParser.parseResult(input, testRunState);

                    assertTestRunState(testRunState, [
                        {
                            name: "MyTests/testFail",
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
                                        actual: '"1"',
                                        expected: '"2"',
                                    },
                                },
                            ],
                            output: inputToTestOutput(input),
                        },
                    ]);
                });

                test("Skipped Test", () => {
                    const input = `Test Case 'MyTests.testSkip' started.
/Users/user/Developer/MyTests/MyTests.swift:90: MyTests.testSkip : Test skipped
Test Case 'MyTests.testSkip' skipped (0.002 seconds).
`;
                    outputParser.parseResult(input, testRunState);

                    assertTestRunState(testRunState, [
                        {
                            name: "MyTests/testSkip",
                            status: TestStatus.skipped,
                            output: inputToTestOutput(input),
                        },
                    ]);
                });
            });
        });
    });
});
