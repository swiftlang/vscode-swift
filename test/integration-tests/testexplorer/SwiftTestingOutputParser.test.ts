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
import { Readable } from "stream";
import * as vscode from "vscode";

import { TestClass } from "@src/TestExplorer/TestDiscovery";
import {
    MAX_PARAMETERIZED_FAILURE_ROWS,
    MAX_PARAMETERIZED_PENDING_ROWS,
    ParameterizedTestCaseSink,
} from "@src/TestExplorer/TestParsers/ParameterizedArgumentRows";
import {
    EventMessage,
    EventRecord,
    EventRecordPayload,
    MessageRenderer,
    SourceLocation,
    SwiftTestEvent,
    SwiftTestingOutputParser,
    TestSymbol,
} from "@src/TestExplorer/TestParsers/SwiftTestingOutputParser";

import { TestRunState, TestStatus } from "./MockTestRunState";

type Outcome = "pass" | "fail" | "warn";

class TestEventStream {
    constructor(private items: SwiftTestEvent[]) {}

    async start(readable: Readable) {
        this.items.forEach(item => {
            readable.push(`${JSON.stringify(item)}\n`);
        });
        readable.push(null);
    }

    async stop() {}
}

suite("SwiftTestingOutputParser Suite", () => {
    let outputParser: SwiftTestingOutputParser;
    let testRunState: TestRunState;

    beforeEach(() => {
        outputParser = new SwiftTestingOutputParser(
            {
                clearParameterizedTestCases: () => {},
                addParameterizedTestCase: () => undefined,
            },
            () => {}
        );
        testRunState = new TestRunState(true);
    });

    /** A sink that records every row it is handed and registers it with the run state. */
    function recordingSink(listed: TestClass[]): ParameterizedTestCaseSink {
        return {
            clearParameterizedTestCases: () => {},
            addParameterizedTestCase: testClass => {
                listed.push(testClass);
                return testRunState.getTestItemIndex(testClass.id);
            },
        };
    }

    function parameterizedRecord(testId: string, count: number): SwiftTestEvent {
        return {
            kind: "test",
            version: 0,
            payload: {
                kind: "function",
                id: testId,
                name: testId,
                isParameterized: true,
                _testCases: Array.from({ length: count }, (_, i) => ({
                    id: `arg-${i}`,
                    displayName: `arg-${i}`,
                })),
                sourceLocation: { _filePath: "file:///f.swift", line: 1, column: 1 },
            },
        } as unknown as SwiftTestEvent;
    }

    type ExtractPayload<T> = T extends { payload: infer E } ? E : never;
    type IssueOverrides = { isFailure?: boolean; severity?: string };
    function testEvent(
        name: ExtractPayload<EventRecord>["kind"],
        testID?: string,
        messages?: EventMessage[],
        sourceLocation?: SourceLocation,
        testCaseID?: string,
        issueOverrides?: IssueOverrides
    ): EventRecord {
        return {
            kind: "event",
            version: 0,
            payload: {
                kind: name,
                instant: { absolute: 0, since1970: 0 },
                messages: messages ?? [],
                ...{ testID, sourceLocation },
                ...(messages
                    ? { issue: { sourceLocation, isKnown: false, ...issueOverrides } }
                    : {}),
                _testCase: {
                    id: testCaseID ?? testID,
                    displayName: testCaseID ?? testID,
                },
            } as EventRecordPayload,
        };
    }

    suite("parameterized argument budgets", () => {
        const TEST_ID = "MyTests.MyTests/testParameterized()";

        function caseEvents(testId: string, index: number, outcome: Outcome): SwiftTestEvent[] {
            const arg = `arg-${index}`;
            const events: SwiftTestEvent[] = [
                testEvent("testCaseStarted", testId, undefined, undefined, arg),
            ];
            if (outcome !== "pass") {
                events.push(
                    testEvent(
                        "issueRecorded",
                        testId,
                        [{ text: `issue ${index}`, symbol: TestSymbol.fail }],
                        { _filePath: "file:///f.swift", line: 1, column: 1 },
                        arg,
                        outcome === "warn" ? { severity: "warning" } : undefined
                    )
                );
            }
            events.push(testEvent("testCaseEnded", testId, undefined, undefined, arg));
            return events;
        }

        async function runFunctions(
            functions: { id: string; outcomes: Outcome[] }[]
        ): Promise<TestClass[]> {
            return runEvents(
                functions.flatMap(fn => [
                    parameterizedRecord(fn.id, fn.outcomes.length),
                    testEvent("testStarted", fn.id),
                    ...fn.outcomes.flatMap((outcome, i) => caseEvents(fn.id, i, outcome)),
                    testEvent("testEnded", fn.id),
                ])
            );
        }

        async function runEvents(events: SwiftTestEvent[]): Promise<TestClass[]> {
            const listed: TestClass[] = [];
            await new SwiftTestingOutputParser(recordingSink(listed), () => {}).watch(
                "file:///mock/named/pipe",
                testRunState,
                new TestEventStream([testEvent("runStarted"), ...events, testEvent("runEnded")])
            );
            return listed;
        }

        const ids = (rows: TestClass[]) => rows.map(row => row.id);

        function outcomes(
            count: number,
            fill: Outcome = "pass",
            overrides: Record<number, Outcome> = {}
        ): Outcome[] {
            return Array.from({ length: count }, (_, i) => overrides[i] ?? fill);
        }

        test("Arguments are listed before any results arrive when they fit in the budget", async () => {
            const listed = await runEvents([parameterizedRecord(TEST_ID, 3)]);

            assert.deepStrictEqual(ids(listed), [
                `${TEST_ID}/arg-0`,
                `${TEST_ID}/arg-1`,
                `${TEST_ID}/arg-2`,
            ]);
        });

        test("A test with more arguments than the budget lists nothing up front", async () => {
            const listed = await runEvents([
                parameterizedRecord(TEST_ID, MAX_PARAMETERIZED_PENDING_ROWS + 1),
            ]);

            assert.strictEqual(listed.length, 0);
        });

        test("A test that does not fit alongside an earlier test lists nothing up front", async () => {
            const listed = await runEvents([
                parameterizedRecord("MyTests.MyTests/first()", MAX_PARAMETERIZED_PENDING_ROWS),
                parameterizedRecord("MyTests.MyTests/second()", 5),
            ]);

            assert.strictEqual(listed.length, MAX_PARAMETERIZED_PENDING_ROWS);
            assert.ok(!ids(listed).some(id => id.startsWith("MyTests.MyTests/second()")));
        });

        test("A held back test lists its failures and summarises its passes in one row", async () => {
            const total = MAX_PARAMETERIZED_PENDING_ROWS + 3;

            const listed = await runFunctions([
                { id: TEST_ID, outcomes: outcomes(total, "pass", { 0: "fail", 1: "fail" }) },
            ]);

            assert.deepStrictEqual(ids(listed), [
                `${TEST_ID}/arg-0`,
                `${TEST_ID}/arg-1`,
                `${TEST_ID}/swift.passedTestCases`,
            ]);
            assert.strictEqual(
                listed[2].label,
                `${(total - 2).toLocaleString()} test cases passed`
            );
        });

        test("A held back test with a single passing argument summarises it in the singular", async () => {
            const total = MAX_PARAMETERIZED_PENDING_ROWS + 1;

            const listed = await runFunctions([
                { id: TEST_ID, outcomes: outcomes(total, "fail", { [total - 1]: "pass" }) },
            ]);

            assert.strictEqual(listed[listed.length - 1].label, "1 test case passed");
        });

        test("A held back test with no passing arguments has no summary row", async () => {
            const listed = await runFunctions([
                { id: TEST_ID, outcomes: outcomes(MAX_PARAMETERIZED_PENDING_ROWS + 1, "fail") },
            ]);

            assert.ok(!ids(listed).some(id => id.endsWith("swift.passedTestCases")));
        });

        test("A test that fits in the budget has no summary row", async () => {
            const listed = await runFunctions([{ id: TEST_ID, outcomes: outcomes(3) }]);

            assert.ok(!ids(listed).some(id => id.endsWith("swift.passedTestCases")));
        });

        test("Failing arguments are capped by their own budget", async () => {
            const listed = await runFunctions([
                { id: TEST_ID, outcomes: outcomes(MAX_PARAMETERIZED_FAILURE_ROWS + 10, "fail") },
            ]);

            assert.strictEqual(listed.length, MAX_PARAMETERIZED_FAILURE_ROWS);
        });

        test("Warnings are listed like failures rather than folded into the summary", async () => {
            const total = MAX_PARAMETERIZED_PENDING_ROWS + 1;

            const listed = await runFunctions([
                { id: TEST_ID, outcomes: outcomes(total, "pass", { 4: "warn" }) },
            ]);

            assert.deepStrictEqual(ids(listed), [
                `${TEST_ID}/arg-4`,
                `${TEST_ID}/swift.passedTestCases`,
            ]);
        });

        test("The pending budget is shared across every parameterized test in the run", async () => {
            const half = Math.floor(MAX_PARAMETERIZED_PENDING_ROWS / 2) + 50;

            const listed = await runFunctions([
                { id: "MyTests.MyTests/first()", outcomes: outcomes(half) },
                { id: "MyTests.MyTests/second()", outcomes: outcomes(half) },
            ]);

            assert.strictEqual(listed.length, half + 1);
            assert.strictEqual(
                listed[listed.length - 1].id,
                "MyTests.MyTests/second()/swift.passedTestCases"
            );
        });

        test("A failure in a later test survives an earlier one spending the pending budget", async () => {
            const listed = await runFunctions([
                {
                    id: "MyTests.MyTests/first()",
                    outcomes: outcomes(MAX_PARAMETERIZED_PENDING_ROWS),
                },
                { id: "MyTests.MyTests/second()", outcomes: ["fail", "fail"] },
            ]);

            assert.ok(ids(listed).includes("MyTests.MyTests/second()/arg-0"));
            assert.ok(ids(listed).includes("MyTests.MyTests/second()/arg-1"));
        });

        test("A failure that outruns the budget is recorded once on its test function", async () => {
            const overBudget = 10;

            await runFunctions([
                {
                    id: TEST_ID,
                    outcomes: outcomes(MAX_PARAMETERIZED_FAILURE_ROWS + overBudget, "fail"),
                },
            ]);

            const testFunction = testRunState.tests.find(test => test.name === TEST_ID);
            assert.strictEqual(
                testFunction?.issues?.length,
                MAX_PARAMETERIZED_FAILURE_ROWS + overBudget
            );
        });

        test("A failure listed without a start event is still given a start time", async () => {
            await runEvents([
                parameterizedRecord(TEST_ID, MAX_PARAMETERIZED_PENDING_ROWS + 1),
                testEvent(
                    "issueRecorded",
                    TEST_ID,
                    [{ text: "issue", symbol: TestSymbol.fail }],
                    { _filePath: "file:///f.swift", line: 1, column: 1 },
                    "arg-0"
                ),
                testEvent("testCaseEnded", TEST_ID, undefined, undefined, "arg-0"),
            ]);

            const row = testRunState.tests.findIndex(test => test.name === `${TEST_ID}/arg-0`);
            assert.notStrictEqual(testRunState.startTimes.get(row), undefined);
        });
    });

    test("Passed test", async () => {
        const events = new TestEventStream([
            testEvent("runStarted"),
            testEvent("testCaseStarted", "MyTests.MyTests/testPass()"),
            testEvent("testCaseEnded", "MyTests.MyTests/testPass()"),
            testEvent("runEnded"),
        ]);

        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        assert.deepEqual(testRunState.tests, [
            {
                name: "MyTests.MyTests/testPass()",
                status: TestStatus.passed,
                timing: { timestamp: 0 },
                output: [],
            },
        ]);
    });

    test("Skipped test", async () => {
        const events = new TestEventStream([
            testEvent("runStarted"),
            testEvent("testSkipped", "MyTests.MyTests/testSkip()"),
            testEvent("runEnded"),
        ]);

        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        assert.deepEqual(testRunState.tests, [
            {
                name: "MyTests.MyTests/testSkip()",
                status: TestStatus.skipped,
                output: [],
            },
        ]);
    });

    async function performTestFailure(messages: EventMessage[]) {
        const issueLocation = {
            _filePath: "file:///some/file.swift",
            line: 1,
            column: 2,
        };
        const events = new TestEventStream([
            testEvent("runStarted"),
            testEvent("testCaseStarted", "MyTests.MyTests/testFail()"),
            testEvent("issueRecorded", "MyTests.MyTests/testFail()", messages, issueLocation),
            testEvent("testCaseEnded", "MyTests.MyTests/testFail()"),
            testEvent("runEnded"),
        ]);

        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        const renderedMessages = messages.map(message => MessageRenderer.render(message));
        const fullFailureMessage = renderedMessages.join("\n");

        assert.deepEqual(testRunState.tests, [
            {
                name: "MyTests.MyTests/testFail()",
                status: TestStatus.failed,
                issues: [
                    {
                        message: fullFailureMessage,
                        location: new vscode.Location(
                            vscode.Uri.file(issueLocation._filePath),
                            new vscode.Position(issueLocation.line - 1, issueLocation?.column ?? 0)
                        ),
                        isKnown: false,
                        diff: undefined,
                    },
                ],
                timing: {
                    timestamp: 0,
                },
                output: [],
            },
        ]);
    }

    test("Failed with an issue that has a comment", async () => {
        await performTestFailure([
            { text: "Expectation failed: bar == foo", symbol: TestSymbol.fail },
            { symbol: TestSymbol.details, text: "// One" },
            { symbol: TestSymbol.details, text: "// Two" },
            { symbol: TestSymbol.details, text: "// Three" },
        ]);
    });

    test("Failed test with one issue", async () => {
        await performTestFailure([
            { text: "Expectation failed: bar == foo", symbol: TestSymbol.fail },
        ]);
    });

    test("Parameterized test", async () => {
        const events = new TestEventStream([
            {
                kind: "test",
                payload: {
                    isParameterized: true,
                    _testCases: [
                        {
                            displayName: "1",
                            id: "argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [49])])",
                        },
                        {
                            displayName: "2",
                            id: "argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [50])])",
                        },
                    ],
                    id: "MyTests.MyTests/testParameterized()",
                    kind: "function",
                    sourceLocation: {
                        _filePath: "file:///some/file.swift",
                        line: 1,
                        column: 2,
                    },
                    name: "testParameterized(_:)",
                },
                version: 0,
            },
            testEvent("runStarted"),
            testEvent("testStarted", "MyTests.MyTests/testParameterized()"),
            testEvent(
                "testCaseStarted",
                "MyTests.MyTests/testParameterized()",
                undefined,
                undefined,
                "argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [49])])"
            ),
            testEvent(
                "testCaseEnded",
                "MyTests.MyTests/testParameterized()",
                undefined,
                undefined,
                "argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [49])])"
            ),
            testEvent(
                "testCaseStarted",
                "MyTests.MyTests/testParameterized()",
                undefined,
                undefined,
                "argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [50])])"
            ),
            testEvent(
                "testCaseEnded",
                "MyTests.MyTests/testParameterized()",
                undefined,
                undefined,
                "argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [50])])"
            ),
            testEvent("testEnded", "MyTests.MyTests/testParameterized()"),
            testEvent("runEnded"),
        ]);

        const outputParser = new SwiftTestingOutputParser(recordingSink([]), () => {});
        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        assert.deepEqual(testRunState.tests, [
            {
                name: "MyTests.MyTests/testParameterized()",
                status: TestStatus.passed,
                timing: { timestamp: 0 },
                output: [],
            },
            {
                name: "MyTests.MyTests/testParameterized()/argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [49])])",
                status: TestStatus.passed,
                timing: { timestamp: 0 },
                output: [],
            },
            {
                name: "MyTests.MyTests/testParameterized()/argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [50])])",
                status: TestStatus.passed,
                timing: { timestamp: 0 },
                output: [],
            },
        ]);
    });

    test("Output is captured", async () => {
        const symbol = TestSymbol.pass;
        const makeEvent = (kind: ExtractPayload<EventRecord>["kind"], testId?: string) =>
            testEvent(kind, testId, [{ text: kind, symbol }]);

        const events = new TestEventStream([
            makeEvent("runStarted"),
            makeEvent("testCaseStarted", "MyTests.MyTests/testOutput()"),
            makeEvent("testCaseEnded", "MyTests.MyTests/testOutput()"),
            makeEvent("testCaseStarted", "MyTests.MyTests/testOutput2()"),
            makeEvent("testCaseEnded", "MyTests.MyTests/testOutput2()"),
            makeEvent("runEnded"),
        ]);

        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        assert.deepEqual(testRunState.tests, [
            {
                name: "MyTests.MyTests/testOutput()",
                output: [],
                status: TestStatus.passed,
                timing: {
                    timestamp: 0,
                },
            },
            {
                name: "MyTests.MyTests/testOutput2()",
                output: [],
                status: TestStatus.passed,
                timing: {
                    timestamp: 0,
                },
            },
        ]);
    });

    test("Issue with isFailure: false is recorded as a warning", async () => {
        const issueLocation = {
            _filePath: "file:///some/file.swift",
            line: 1,
            column: 2,
        };
        const events = new TestEventStream([
            testEvent("runStarted"),
            testEvent("testCaseStarted", "MyTests.MyTests/testWarning()"),
            testEvent(
                "issueRecorded",
                "MyTests.MyTests/testWarning()",
                [{ text: "This is a warning", symbol: TestSymbol.warning }],
                issueLocation,
                undefined,
                { isFailure: false }
            ),
            testEvent("testCaseEnded", "MyTests.MyTests/testWarning()"),
            testEvent("runEnded"),
        ]);

        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        assert.deepEqual(testRunState.tests, [
            {
                name: "MyTests.MyTests/testWarning()",
                status: TestStatus.passed,
                timing: { timestamp: 0 },
                output: [],
                warnings: [
                    {
                        message: "This is a warning",
                        location: new vscode.Location(
                            vscode.Uri.file(issueLocation._filePath),
                            new vscode.Position(issueLocation.line - 1, issueLocation.column)
                        ),
                    },
                ],
            },
        ]);
    });

    test("Issue with severity: warning is recorded as a warning and the test passes", async () => {
        const issueLocation = {
            _filePath: "file:///some/file.swift",
            line: 4,
            column: 7,
        };
        const events = new TestEventStream([
            testEvent("runStarted"),
            testEvent("testCaseStarted", "MyTests.MyTests/testWarning()"),
            testEvent(
                "issueRecorded",
                "MyTests.MyTests/testWarning()",
                [{ text: "Deprecated API used", symbol: TestSymbol.warning }],
                issueLocation,
                undefined,
                { severity: "warning", isFailure: false }
            ),
            testEvent("testCaseEnded", "MyTests.MyTests/testWarning()"),
            testEvent("runEnded"),
        ]);

        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        assert.deepEqual(testRunState.tests, [
            {
                name: "MyTests.MyTests/testWarning()",
                status: TestStatus.passed,
                timing: { timestamp: 0 },
                output: [],
                warnings: [
                    {
                        message: "Deprecated API used",
                        location: new vscode.Location(
                            vscode.Uri.file(issueLocation._filePath),
                            new vscode.Position(issueLocation.line - 1, issueLocation.column)
                        ),
                    },
                ],
            },
        ]);
    });

    test("A test with both a warning and a failing issue still fails", async () => {
        const issueLocation = {
            _filePath: "file:///some/file.swift",
            line: 1,
            column: 2,
        };
        const events = new TestEventStream([
            testEvent("runStarted"),
            testEvent("testCaseStarted", "MyTests.MyTests/testMixed()"),
            testEvent(
                "issueRecorded",
                "MyTests.MyTests/testMixed()",
                [{ text: "A warning", symbol: TestSymbol.warning }],
                issueLocation,
                undefined,
                { severity: "warning", isFailure: false }
            ),
            testEvent(
                "issueRecorded",
                "MyTests.MyTests/testMixed()",
                [{ text: "Expectation failed: bar == foo", symbol: TestSymbol.fail }],
                issueLocation
            ),
            testEvent("testCaseEnded", "MyTests.MyTests/testMixed()"),
            testEvent("runEnded"),
        ]);

        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        assert.equal(testRunState.tests.length, 1);
        assert.equal(testRunState.tests[0].status, TestStatus.failed);
        assert.equal(testRunState.tests[0].warnings?.length, 1);
        assert.equal(testRunState.tests[0].warnings?.[0].message, "A warning");
        assert.equal(testRunState.tests[0].issues?.length, 1);
    });
});
