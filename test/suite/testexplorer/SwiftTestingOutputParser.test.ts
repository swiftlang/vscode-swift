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
import * as vscode from "vscode";
import { beforeEach } from "mocha";
import {
    SwiftTestEvent,
    EventRecord,
    SwiftTestingOutputParser,
    EventRecordPayload,
    EventMessage,
    SourceLocation,
    TestSymbol,
    SymbolRenderer,
    MessageRenderer,
} from "../../../src/TestExplorer/TestParsers/SwiftTestingOutputParser";
import { TestRunState, TestStatus } from "./MockTestRunState";

function buildEventStream(items: (SwiftTestEvent | string)[]): string {
    return items.map(item => (typeof item === "string" ? item : JSON.stringify(item))).join("\n");
}

suite("SwiftTestingOutputParser Suite", () => {
    let outputParser: SwiftTestingOutputParser;

    beforeEach(() => {
        outputParser = new SwiftTestingOutputParser(
            () => {},
            () => {}
        );
    });

    async function parseResults(
        parser: SwiftTestingOutputParser,
        events: string,
        testRunState: TestRunState,
        expectedLogOutput: string[] = []
    ) {
        const logs: string[] = [];
        await parser.parseResult(events, testRunState, output => logs.push(output));
        assert.deepStrictEqual(
            logs,
            expectedLogOutput.map(line => `${line}\r\n`),
            "Unexpected test run log output"
        );
        return testRunState.tests;
    }

    type ExtractPayload<T> = T extends { payload: infer E } ? E : never;
    function testEvent(
        name: ExtractPayload<EventRecord>["kind"],
        testID?: string,
        messages?: EventMessage[],
        sourceLocation?: SourceLocation,
        testCaseID?: string
    ): EventRecord {
        return {
            kind: "event",
            version: 0,
            payload: {
                kind: name,
                instant: { absolute: 0, since1970: 0 },
                messages: messages ?? [],
                ...{ testID, sourceLocation },
                ...(messages ? { issue: { sourceLocation, isKnown: false } } : {}),
                _testCase: {
                    id: testCaseID ?? testID,
                    displayName: testCaseID ?? testID,
                },
            } as EventRecordPayload,
        };
    }

    test("Passed test", async () => {
        const testRunState = new TestRunState(["MyTests.MyTests/testPass()"], true);
        const events = buildEventStream([
            testEvent("runStarted"),
            testEvent("testCaseStarted", "MyTests.MyTests/testPass()"),
            testEvent("testCaseEnded", "MyTests.MyTests/testPass()"),
            testEvent("runEnded"),
        ]);

        const results = await parseResults(outputParser, events, testRunState);

        assert.deepEqual(results, [
            {
                name: "MyTests.MyTests/testPass()",
                status: TestStatus.passed,
                timing: { timestamp: 0 },
                output: [],
            },
        ]);
    });

    test("Skipped test", async () => {
        const testRunState = new TestRunState(["MyTests.MyTests/testSkip()"], true);
        const events = buildEventStream([
            testEvent("runStarted"),
            testEvent("testSkipped", "MyTests.MyTests/testSkip()"),
            testEvent("runEnded"),
        ]);

        const results = await parseResults(outputParser, events, testRunState);

        assert.deepEqual(results, [
            {
                name: "MyTests.MyTests/testSkip()",
                status: TestStatus.skipped,
                output: [],
            },
        ]);
    });

    async function performTestFailure(messages: EventMessage[]) {
        const testRunState = new TestRunState(["MyTests.MyTests/testFail()"], true);
        const issueLocation = {
            _filePath: "file:///some/file.swift",
            line: 1,
            column: 2,
        };
        const events = buildEventStream([
            testEvent("runStarted"),
            testEvent("testCaseStarted", "MyTests.MyTests/testFail()"),
            testEvent("issueRecorded", "MyTests.MyTests/testFail()", messages, issueLocation),
            testEvent("testCaseEnded", "MyTests.MyTests/testFail()"),
            testEvent("runEnded"),
        ]);

        const results = await parseResults(outputParser, events, testRunState);

        const renderedMessages = messages.map(message => MessageRenderer.render(message));
        const fullFailureMessage = renderedMessages.join("\n");

        assert.deepEqual(results, [
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
                output: renderedMessages.map(message => `${message}\r\n`),
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
        const testRunState = new TestRunState(["MyTests.MyTests/testParameterized()"], true);
        const events = buildEventStream([
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

        const outputParser = new SwiftTestingOutputParser(
            () => {},
            testClass => {
                testRunState.testItemFinder.tests.push({
                    name: testClass.id,
                    status: TestStatus.enqueued,
                    output: [],
                });
            }
        );
        const results = await parseResults(outputParser, events, testRunState);

        assert.deepEqual(results, [
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

    suite("Output capture", () => {
        test("Output is captured", async () => {
            const testRunState = new TestRunState(["MyTests.MyTests/testPass()"], true);
            const events = buildEventStream([
                "its preamble and should be ignored",
                testEvent("runStarted"),
                testEvent("testCaseStarted", "MyTests.MyTests/testPass()"),
                "the test output",
                testEvent("testCaseEnded", "MyTests.MyTests/testPass()"),
                testEvent("runEnded"),
                "its over",
            ]);

            const results = await parseResults(outputParser, events, testRunState, [
                "the test output",
                "its over",
            ]);

            assert.deepEqual(outputParser.logs, [events]);
            assert.deepEqual(results, [
                {
                    name: "MyTests.MyTests/testPass()",
                    status: TestStatus.passed,
                    timing: { timestamp: 0 },
                    output: [],
                },
            ]);
        });

        test("Output that resembles JSON but isn't is captured", async () => {
            const testRunState = new TestRunState([], true);
            const events = buildEventStream([
                testEvent("runStarted"),
                '{ "kind_of_like_json_with_no_closing_brace": ""',
                testEvent("runEnded"),
                "its over",
            ]);

            const results = await parseResults(outputParser, events, testRunState, [
                '{ "kind_of_like_json_with_no_closing_brace": ""',
                "its over",
            ]);

            assert.deepEqual(outputParser.logs, [events]);
            assert.deepEqual(results, []);
        });

        test("Output that is JSON but isn't a test event", async () => {
            const testRunState = new TestRunState([], true);
            const events = buildEventStream([
                testEvent("runStarted"),
                '{ "valid_json": true }',
                testEvent("runEnded"),
                "its over",
            ]);

            const results = await parseResults(outputParser, events, testRunState, [
                '{ "valid_json": true }',
                "its over",
            ]);

            assert.deepEqual(outputParser.logs, [events]);
            assert.deepEqual(results, []);
        });
    });

    test("Multiple test cases", async () => {
        const testRunState = new TestRunState(
            ["MyTests.MyTests/testOutput()", "MyTests.MyTests/testOutput2()"],
            true
        );
        const symbol = TestSymbol.pass;
        const renderedSymbol = SymbolRenderer.symbol(symbol);
        const makeEvent = (kind: ExtractPayload<EventRecord>["kind"], testId?: string) =>
            testEvent(kind, testId, [{ text: kind, symbol }]);

        const events = buildEventStream([
            makeEvent("runStarted"),
            makeEvent("testCaseStarted", "MyTests.MyTests/testOutput()"),
            makeEvent("testCaseEnded", "MyTests.MyTests/testOutput()"),
            makeEvent("testCaseStarted", "MyTests.MyTests/testOutput2()"),
            makeEvent("testCaseEnded", "MyTests.MyTests/testOutput2()"),
            makeEvent("runEnded"),
        ]);

        const results = await parseResults(outputParser, events, testRunState);

        assert.deepEqual(results, [
            {
                name: "MyTests.MyTests/testOutput()",
                output: [
                    `\u001b[92m${renderedSymbol}\u001b[0m testCaseStarted\r\n`,
                    `\u001b[92m${renderedSymbol}\u001b[0m testCaseEnded\r\n`,
                ],
                status: TestStatus.passed,
                timing: {
                    timestamp: 0,
                },
            },
            {
                name: "MyTests.MyTests/testOutput2()",
                output: [
                    `\u001b[92m${renderedSymbol}\u001b[0m testCaseStarted\r\n`,
                    `\u001b[92m${renderedSymbol}\u001b[0m testCaseEnded\r\n`,
                ],
                status: TestStatus.passed,
                timing: {
                    timestamp: 0,
                },
            },
        ]);
    });
});
