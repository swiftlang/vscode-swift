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
import * as vscode from "vscode";
import {
    SwiftTestEvent,
    EventRecord,
    SwiftTestingOutputParser,
    EventRecordPayload,
    EventMessage,
    SourceLocation,
} from "../../../src/TestExplorer/TestParsers/SwiftTestingOutputParser";
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
    const outputParser = new SwiftTestingOutputParser(
        () => {},
        () => {}
    );

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
                ...(messages ? { issue: { sourceLocation } } : {}),
                _testCase: {
                    id: testCaseID ?? testID,
                    displayName: testCaseID ?? testID,
                },
            } as EventRecordPayload,
        };
    }

    test("Passed test", async () => {
        const testRunState = new TestRunState(["MyTests.MyTests/testPass()"], true);
        const events = new TestEventStream([
            testEvent("runStarted"),
            testEvent("testCaseStarted", "MyTests.MyTests/testPass()"),
            testEvent("testCaseEnded", "MyTests.MyTests/testPass()"),
            testEvent("runEnded"),
        ]);
        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        const runState = testRunState.tests[0];
        assert.strictEqual(runState.status, TestStatus.passed);
        assert.deepEqual(runState.timing, { timestamp: 0 });
    });

    test("Skipped test", async () => {
        const testRunState = new TestRunState(["MyTests.MyTests/testSkip()"], true);
        const events = new TestEventStream([
            testEvent("runStarted"),
            testEvent("testSkipped", "MyTests.MyTests/testSkip()"),
            testEvent("runEnded"),
        ]);
        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        const runState = testRunState.tests[0];
        assert.strictEqual(runState.status, TestStatus.skipped);
    });

    test("Failed test with one issue", async () => {
        const testRunState = new TestRunState(["MyTests.MyTests/testFail()"], true);
        const issueLocation = {
            _filePath: "file:///some/file.swift",
            line: 1,
            column: 2,
        };
        const events = new TestEventStream([
            testEvent("runStarted"),
            testEvent("testCaseStarted", "MyTests.MyTests/testFail()"),
            testEvent(
                "issueRecorded",
                "MyTests.MyTests/testFail()",
                [{ text: "Expectation failed: bar == foo" }],
                issueLocation
            ),
            testEvent("testCaseEnded", "MyTests.MyTests/testFail()"),
            testEvent("runEnded"),
        ]);
        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        const runState = testRunState.tests[0];
        assert.strictEqual(runState.status, TestStatus.failed);
        assert.deepEqual(runState.issues, [
            {
                message: "Expectation failed: bar == foo",
                location: new vscode.Location(
                    vscode.Uri.file(issueLocation._filePath),
                    new vscode.Position(issueLocation.line - 1, issueLocation?.column ?? 0)
                ),
                isKnown: false,
            },
        ]);
    });

    test("Parameterized test", async () => {
        const testRunState = new TestRunState(["MyTests.MyTests/testParameterized()"], true);
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
                });
            }
        );
        await outputParser.watch("file:///mock/named/pipe", testRunState, events);

        assert.strictEqual(testRunState.tests.length, 3);
        testRunState.tests.forEach(runState => {
            assert.strictEqual(runState.status, TestStatus.passed);
            assert.deepEqual(runState.timing, { timestamp: 0 });
        });
    });
});
