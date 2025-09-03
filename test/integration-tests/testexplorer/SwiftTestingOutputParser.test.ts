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
    MessageRenderer,
} from "@src/TestExplorer/TestParsers/SwiftTestingOutputParser";
import { TestRunState, TestStatus } from "./MockTestRunState";
import { Readable } from "stream";

class TestEventStream {
    constructor(private items: SwiftTestEvent[]) {}

    async start(readable: Readable) {
        this.items.forEach(item => {
            readable.push(`${JSON.stringify(item)}\n`);
        });
        readable.push(null);
    }
}

suite("SwiftTestingOutputParser Suite", () => {
    let outputParser: SwiftTestingOutputParser;
    let testRunState: TestRunState;

    beforeEach(() => {
        outputParser = new SwiftTestingOutputParser(
            () => {},
            () => {},
            () => {}
        );
        testRunState = new TestRunState(true);
    });

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
            },
            () => {}
        );
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

    test("Issue with isFailure: false isn't recorded", async () => {
        const issueLocation = {
            _filePath: "file:///some/file.swift",
            line: 1,
            column: 2,
        };
        const issueEvent = testEvent(
            "issueRecorded",
            "MyTests.MyTests/testWarning()",
            [{ text: "This is a warning", symbol: TestSymbol.warning }],
            issueLocation
        );
        (issueEvent.payload as any).issue.isFailure = false;

        const events = new TestEventStream([
            testEvent("runStarted"),
            testEvent("testCaseStarted", "MyTests.MyTests/testWarning()"),
            issueEvent,
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
            },
        ]);
    });
});
