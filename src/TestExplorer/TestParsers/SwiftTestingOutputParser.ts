//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { ITestRunState } from "./TestRunState";
import { TestClass } from "../TestDiscovery";
import { sourceLocationToVSCodeLocation } from "../../utilities/utilities";
import { StringColor } from "../../utilities/ansi";
import { ITestOutputParser } from "./XCTestOutputParser";

// All events produced by a swift-testing run will be one of these three types.
// Detailed information about swift-testing's JSON schema is available here:
// https://github.com/apple/swift-testing/blob/main/Documentation/ABI/JSON.md
export type SwiftTestEvent = MetadataRecord | TestRecord | EventRecord;

interface VersionedRecord {
    version: number;
}

interface MetadataRecord extends VersionedRecord {
    kind: "metadata";
    payload: Metadata;
}

interface TestRecord extends VersionedRecord {
    kind: "test";
    payload: TestSuite | TestFunction;
}

export type EventRecordPayload =
    | RunStarted
    | TestStarted
    | TestEnded
    | TestCaseStarted
    | TestCaseEnded
    | IssueRecorded
    | TestSkipped
    | RunEnded;

export interface EventRecord extends VersionedRecord {
    kind: "event";
    payload: EventRecordPayload;
}

interface Metadata {
    [key: string]: object; // Currently unstructured content
}

interface TestBase {
    id: string;
    name: string;
    _testCases?: TestCase[];
    sourceLocation: SourceLocation;
}

interface TestSuite extends TestBase {
    kind: "suite";
}

interface TestFunction extends TestBase {
    kind: "function";
    isParameterized: boolean;
}

export interface TestCase {
    id: string;
    displayName: string;
}

// Event types
interface RunStarted {
    kind: "runStarted";
    messages: EventMessage[];
}

interface RunEnded {
    kind: "runEnded";
    messages: EventMessage[];
}

interface Instant {
    absolute: number;
    since1970: number;
}

interface BaseEvent {
    instant: Instant;
    messages: EventMessage[];
    testID: string;
}

interface TestCaseEvent {
    sourceLocation: SourceLocation;
    _testCase?: TestCase;
}

interface TestStarted extends BaseEvent {
    kind: "testStarted";
}

interface TestEnded extends BaseEvent {
    kind: "testEnded";
}

interface TestCaseStarted extends BaseEvent, TestCaseEvent {
    kind: "testCaseStarted";
}

interface TestCaseEnded extends BaseEvent, TestCaseEvent {
    kind: "testCaseEnded";
}

interface TestSkipped extends BaseEvent {
    kind: "testSkipped";
}

interface IssueRecorded extends BaseEvent, TestCaseEvent {
    kind: "issueRecorded";
    issue: {
        isKnown: boolean;
        sourceLocation: SourceLocation;
    };
}

export enum TestSymbol {
    default = "default",
    skip = "skip",
    passWithKnownIssue = "passWithKnownIssue",
    fail = "fail",
    pass = "pass",
    difference = "difference",
    warning = "warning",
    details = "details",
    none = "none",
}

export interface EventMessage {
    symbol: TestSymbol;
    text: string;
}

export interface SourceLocation {
    _filePath: string;
    line: number;
    column: number;
}

export class SwiftTestingOutputParser implements ITestOutputParser {
    public logs: string[] = [];

    private completionMap = new Map<number, boolean>();
    private testCaseMap = new Map<string, Map<string, TestCase>>();
    private preambleComplete = false;

    constructor(
        public testRunStarted: () => void,
        public addParameterizedTestCase: (testClass: TestClass, parentIndex: number) => void
    ) {}

    /**
     * Parse test run output looking for both raw output and JSON events.
     * @param output A chunk of stdout emitted during a test run.
     * @param runState The test run state to be updated by the output
     * @param logger A logging function to capture output not associated with a specific test.
     */
    parseResult(output: string, runState: ITestRunState, logger: (output: string) => void): void {
        this.logs.push(output);

        for (const line of output.split("\n")) {
            if (line.startsWith("{")) {
                try {
                    // On Windows lines end will end with some ANSI characters, so
                    // work around that by trying to parse from the start of the line
                    // to the last '}' character.
                    const closingBrace = line.lastIndexOf("}");
                    if (closingBrace === -1) {
                        // Break out of the try block and continue
                        throw new Error("No closing brace found");
                    }

                    const maybeJSON = line.substring(0, closingBrace + 1);

                    const event = JSON.parse(maybeJSON);
                    if (this.isValidEvent(event)) {
                        this.parse(event, runState);
                        this.preambleComplete = true;
                        continue;
                    }
                } catch {
                    // Output wasn't valid JSON, continue and treat it like regular output
                }
            }

            // Any line in stdout that fails to match as a swift-testing line is treated
            // as a user printed value and recorded to the test run output with no associated test.
            const trimmed = line.trim();
            if (this.preambleComplete && trimmed.length > 0) {
                logger(`${trimmed}\r\n`);
            }
        }
    }

    /**
     * Type guard for validating that an event is a valid SwiftTestEvent.
     * This is not an exaustive validation, but it is sufficient for our purposes.
     *
     * @param event The event to validate.
     * @returns `true` if the event is a valid SwiftTestEvent, `false` otherwise.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private isValidEvent(event: any): event is SwiftTestEvent {
        return (
            typeof event === "object" &&
            event !== null &&
            (event.kind === "test" ||
                event.kind === "event" ||
                event.kind === "metadata" ||
                event.kind === "runStarted" ||
                event.kind === "runEnded")
        );
    }

    private testName(id: string): string {
        const nameMatcher = /^(.*\(.*\))\/(.*)\.swift:\d+:\d+$/;
        const matches = id.match(nameMatcher);
        return !matches ? id : matches[1];
    }

    private testCaseId(testId: string, testCaseId: string): string {
        const testCase = this.testCaseMap.get(testId)?.get(testCaseId);
        return testCase ? `${testId}/${this.idFromTestCase(testCase)}` : testId;
    }

    // Test cases do not have a unique ID if their arguments are not serializable
    // with Codable. If they aren't, their id appears as `argumentIDs: nil`, and we
    // fall back to using the testCase display name as the test case ID. This isn't
    // ideal because its possible to have multiple test cases with the same display name,
    // but until we have a better solution for identifying test cases it will have to do.
    // SEE: rdar://119522099.
    private idFromTestCase(testCase: TestCase): string {
        return testCase.id === "argumentIDs: nil" ? testCase.displayName : testCase.id;
    }

    private idFromOptionalTestCase(testID: string, testCase?: TestCase): string {
        return testCase
            ? this.testCaseId(testID, this.idFromTestCase(testCase))
            : this.testName(testID);
    }

    private parameterizedFunctionTestCaseToTestClass(
        testId: string,
        testCase: TestCase,
        location: vscode.Location,
        index: number
    ): TestClass {
        return {
            id: this.testCaseId(testId, this.idFromTestCase(testCase)),
            label: testCase.displayName,
            tags: [],
            children: [],
            style: "swift-testing",
            location: location,
            disabled: true,
            sortText: `${index}`.padStart(8, "0"),
        };
    }

    private buildTestCaseMapForParameterizedTest(record: TestRecord) {
        const map = new Map<string, TestCase>();
        (record.payload._testCases ?? []).forEach(testCase => {
            map.set(this.idFromTestCase(testCase), testCase);
        });
        this.testCaseMap.set(record.payload.id, map);
    }

    private getTestCaseIndex(runState: ITestRunState, testID: string): number {
        const fullNameIndex = runState.getTestItemIndex(testID, undefined);
        if (fullNameIndex === -1) {
            return runState.getTestItemIndex(this.testName(testID), undefined);
        }
        return fullNameIndex;
    }

    private recordOutput(
        runState: ITestRunState,
        messages: EventMessage[],
        testIndex: number | undefined
    ) {
        messages.forEach(message => {
            runState.recordOutput(testIndex, `${MessageRenderer.render(message)}\r\n`);
        });
    }

    /**
     * Partitions a collection of messages in to issues and details about the issues.
     * This is used to print the issues first, followed by the details.
     */
    private partitionIssueMessages(messages: EventMessage[]): {
        issues: EventMessage[];
        details: EventMessage[];
    } {
        return messages.reduce(
            (buckets, message) => {
                const key =
                    message.symbol === "details" ||
                    message.symbol === "default" ||
                    message.symbol === "none"
                        ? "details"
                        : "issues";
                return { ...buckets, [key]: [...buckets[key], message] };
            },
            {
                issues: [],
                details: [],
            }
        );
    }

    /*
     * A multi line comment preceeding an issue will have a 'default' symbol for
     * all lines except the first one. To match the swift-testing command line we
     * should show no symbol on these lines.
     */
    private transformIssueMessageSymbols(messages: EventMessage[]): EventMessage[] {
        return messages.map(message => ({
            ...message,
            symbol: message.symbol === "default" ? TestSymbol.none : message.symbol,
        }));
    }

    private parse(item: SwiftTestEvent, runState: ITestRunState) {
        if (
            item.kind === "test" &&
            item.payload.kind === "function" &&
            item.payload.isParameterized &&
            item.payload._testCases
        ) {
            // Store a map of [Test ID, [Test Case ID, TestCase]] so we can quickly
            // map an event.payload.testID back to a test case.
            this.buildTestCaseMapForParameterizedTest(item);

            const testName = this.testName(item.payload.id);
            const testIndex = runState.getTestItemIndex(testName, undefined);
            // If a test has test cases it is paramterized and we need to notify
            // the caller that the TestClass should be added to the vscode.TestRun
            // before it starts.
            item.payload._testCases
                .map((testCase, index) =>
                    this.parameterizedFunctionTestCaseToTestClass(
                        item.payload.id,
                        testCase,
                        sourceLocationToVSCodeLocation(
                            item.payload.sourceLocation._filePath,
                            item.payload.sourceLocation.line,
                            item.payload.sourceLocation.column
                        ),
                        index
                    )
                )
                .flatMap(testClass => (testClass ? [testClass] : []))
                .forEach(testClass => this.addParameterizedTestCase(testClass, testIndex));
        } else if (item.kind === "event") {
            if (item.payload.kind === "runStarted") {
                // Notify the runner that we've recieved all the test cases and
                // are going to start running tests now.
                this.testRunStarted();
            } else if (item.payload.kind === "testStarted") {
                const testName = this.testName(item.payload.testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                runState.started(testIndex, item.payload.instant.absolute);
                this.recordOutput(runState, item.payload.messages, testIndex);
                return;
            } else if (item.payload.kind === "testCaseStarted") {
                const testID = this.idFromOptionalTestCase(
                    item.payload.testID,
                    item.payload._testCase
                );
                const testIndex = this.getTestCaseIndex(runState, testID);
                runState.started(testIndex, item.payload.instant.absolute);
                this.recordOutput(runState, item.payload.messages, testIndex);
                return;
            } else if (item.payload.kind === "testSkipped") {
                const testName = this.testName(item.payload.testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                runState.skipped(testIndex);
                this.recordOutput(runState, item.payload.messages, testIndex);
                return;
            } else if (item.payload.kind === "issueRecorded") {
                const testID = this.idFromOptionalTestCase(
                    item.payload.testID,
                    item.payload._testCase
                );
                const testIndex = this.getTestCaseIndex(runState, testID);

                const isKnown = item.payload.issue.isKnown;
                const sourceLocation = item.payload.issue.sourceLocation;
                const location = sourceLocationToVSCodeLocation(
                    sourceLocation._filePath,
                    sourceLocation.line,
                    sourceLocation.column
                );

                const messages = this.transformIssueMessageSymbols(item.payload.messages);
                const { issues, details } = this.partitionIssueMessages(messages);

                // Order the details after the issue text.
                const additionalDetails = details
                    .map(message => MessageRenderer.render(message))
                    .join("\n");

                issues.forEach(message => {
                    runState.recordIssue(
                        testIndex,
                        additionalDetails.length > 0
                            ? `${MessageRenderer.render(message)}\n${additionalDetails}`
                            : MessageRenderer.render(message),
                        isKnown,
                        location
                    );
                });

                this.recordOutput(runState, messages, testIndex);

                if (item.payload._testCase && testID !== item.payload.testID) {
                    const testIndex = this.getTestCaseIndex(runState, item.payload.testID);
                    messages.forEach(message => {
                        runState.recordIssue(testIndex, message.text, isKnown, location);
                    });
                }
                return;
            } else if (item.payload.kind === "testEnded") {
                const testName = this.testName(item.payload.testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                this.recordOutput(runState, item.payload.messages, testIndex);

                // When running a single test the testEnded and testCaseEnded events
                // have the same ID, and so we'd end the same test twice.
                if (this.completionMap.get(testIndex)) {
                    return;
                }
                this.completionMap.set(testIndex, true);
                runState.completed(testIndex, { timestamp: item.payload.instant.absolute });
                return;
            } else if (item.payload.kind === "testCaseEnded") {
                const testID = this.idFromOptionalTestCase(
                    item.payload.testID,
                    item.payload._testCase
                );
                const testIndex = this.getTestCaseIndex(runState, testID);
                this.recordOutput(runState, item.payload.messages, testIndex);

                // When running a single test the testEnded and testCaseEnded events
                // have the same ID, and so we'd end the same test twice.
                if (this.completionMap.get(testIndex)) {
                    return;
                }
                this.completionMap.set(testIndex, true);
                runState.completed(testIndex, { timestamp: item.payload.instant.absolute });
                return;
            }

            // this.recordOutput(runState, item.payload.messages, undefined);
        }
    }
}

export class MessageRenderer {
    /**
     * Converts a swift-testing `EventMessage` to a colorized symbol and message text.
     *
     * @param message An event message, typically found on an `EventRecordPayload`.
     * @returns A string colorized with ANSI escape codes.
     */
    static render(message: EventMessage): string {
        return `${SymbolRenderer.eventMessageSymbol(message.symbol)} ${MessageRenderer.colorize(message.symbol, message.text)}`;
    }

    private static colorize(symbolType: TestSymbol, message: string): string {
        switch (symbolType) {
            case TestSymbol.details:
            case TestSymbol.skip:
            case TestSymbol.difference:
            case TestSymbol.passWithKnownIssue:
                return StringColor.default(message);
            default:
                return message;
        }
    }
}

export class SymbolRenderer {
    /**
     * Converts a swift-testing symbol identifier in to a colorized unicode symbol.
     *
     * @param message An event message, typically found on an `EventRecordPayload`.
     * @returns A string colorized with ANSI escape codes.
     */
    static eventMessageSymbol(symbol: TestSymbol): string {
        return this.colorize(symbol, this.symbol(symbol));
    }

    // This is adapted from
    // https://github.com/apple/swift-testing/blob/786ade71421eb1d8a9c1d99c902cf1c93096e7df/Sources/Testing/Events/Recorder/Event.Symbol.swift#L102
    public static symbol(symbol: TestSymbol): string {
        if (process.platform === "win32") {
            switch (symbol) {
                case TestSymbol.default:
                    return "\u{25CA}"; // Unicode: LOZENGE
                case TestSymbol.skip:
                case TestSymbol.passWithKnownIssue:
                case TestSymbol.fail:
                    return "\u{00D7}"; // Unicode: MULTIPLICATION SIGN
                case TestSymbol.pass:
                    return "\u{221A}"; // Unicode: SQUARE ROOT
                case TestSymbol.difference:
                    return "\u{00B1}"; // Unicode: PLUS-MINUS SIGN
                case TestSymbol.warning:
                    return "\u{25B2}"; // Unicode: BLACK UP-POINTING TRIANGLE
                case TestSymbol.details:
                    return "\u{2192}"; // Unicode: RIGHTWARDS ARROW
                case TestSymbol.none:
                    return "";
            }
        } else {
            switch (symbol) {
                case TestSymbol.default:
                    return "\u{25C7}"; // Unicode: WHITE DIAMOND
                case TestSymbol.skip:
                case TestSymbol.passWithKnownIssue:
                case TestSymbol.fail:
                    return "\u{2718}"; // Unicode: HEAVY BALLOT X
                case TestSymbol.pass:
                    return "\u{2714}"; // Unicode: HEAVY CHECK MARK
                case TestSymbol.difference:
                    return "\u{00B1}"; // Unicode: PLUS-MINUS SIGN
                case TestSymbol.warning:
                    return "\u{26A0}\u{FE0E}"; // Unicode: WARNING SIGN + VARIATION SELECTOR-15 (disable emoji)
                case TestSymbol.details:
                    return "\u{21B3}"; // Unicode: DOWNWARDS ARROW WITH TIP RIGHTWARDS
                case TestSymbol.none:
                    return " ";
            }
        }
    }

    // This is adapted from
    // https://github.com/apple/swift-testing/blob/786ade71421eb1d8a9c1d99c902cf1c93096e7df/Sources/Testing/Events/Recorder/Event.ConsoleOutputRecorder.swift#L164
    private static colorize(symbolType: TestSymbol, symbol: string): string {
        switch (symbolType) {
            case TestSymbol.default:
            case TestSymbol.details:
            case TestSymbol.skip:
            case TestSymbol.difference:
            case TestSymbol.passWithKnownIssue:
                return StringColor.default(symbol);
            case TestSymbol.pass:
                return StringColor.green(symbol);
            case TestSymbol.fail:
                return StringColor.red(symbol);
            case TestSymbol.warning:
                return StringColor.yellow(symbol);
            case TestSymbol.none:
            default:
                return symbol;
        }
    }
}
