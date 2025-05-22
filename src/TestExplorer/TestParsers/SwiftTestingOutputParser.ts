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
import * as readline from "readline";
import { Readable } from "stream";
import {
    INamedPipeReader,
    UnixNamedPipeReader,
    WindowsNamedPipeReader,
} from "./TestEventStreamReader";
import { ITestRunState } from "./TestRunState";
import { TestClass } from "../TestDiscovery";
import { sourceLocationToVSCodeLocation } from "../../utilities/utilities";
import { exec } from "child_process";
import { lineBreakRegex } from "../../utilities/tasks";

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
    | RunEnded
    | ValueAttached;

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

interface ValueAttached {
    kind: "_valueAttached";
    _attachment: {
        path?: string;
    };
    testID: string;
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
    attachment = "attachment",
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

export class SwiftTestingOutputParser {
    private completionMap = new Map<number, boolean>();
    private testCaseMap = new Map<string, Map<string, TestCase>>();
    private path?: string;

    constructor(
        public testRunStarted: () => void,
        public addParameterizedTestCase: (testClass: TestClass, parentIndex: number) => void,
        public onAttachment: (testIndex: number, path: string) => void
    ) {}

    /**
     * Watches for test events on the named pipe at the supplied path.
     * As events are read they are parsed and recorded in the test run state.
     */
    public async watch(
        path: string,
        runState: ITestRunState,
        pipeReader?: INamedPipeReader
    ): Promise<void> {
        this.path = path;

        // Creates a reader based on the platform unless being provided in a test context.
        const reader = pipeReader ?? this.createReader(path);
        const readlinePipe = new Readable({
            read() {},
        });

        // Use readline to automatically chunk the data into lines,
        // and then take each line and parse it as JSON.
        const rl = readline.createInterface({
            input: readlinePipe,
            crlfDelay: Infinity,
        });

        rl.on("line", line => this.parse(JSON.parse(line), runState));

        await reader.start(readlinePipe);
    }

    /**
     * Closes the FIFO pipe after a test run. This must be called at the
     * end of a run regardless of the run's success or failure.
     */
    public async close() {
        if (!this.path) {
            return;
        }

        await new Promise<void>(resolve => {
            exec(`echo '{}' > ${this.path}`, () => {
                resolve();
            });
        });
    }

    /**
     * Parses stdout of a test run looking for lines that were not captured by
     * a JSON event and injecting them in to the test run output.
     * @param chunk A chunk of stdout emitted during a test run.
     */
    public parseStdout(chunk: string, runState: ITestRunState) {
        for (const line of chunk.split(lineBreakRegex)) {
            if (line.trim().length > 0) {
                runState.recordOutput(undefined, `${line}\r\n`);
            }
        }
    }

    private createReader(path: string): INamedPipeReader {
        return process.platform === "win32"
            ? new WindowsNamedPipeReader(path)
            : new UnixNamedPipeReader(path);
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
                return;
            } else if (item.payload.kind === "testStarted") {
                const testName = this.testName(item.payload.testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                runState.started(testIndex, item.payload.instant.absolute);
                return;
            } else if (item.payload.kind === "testCaseStarted") {
                const testID = this.idFromOptionalTestCase(
                    item.payload.testID,
                    item.payload._testCase
                );
                const testIndex = this.getTestCaseIndex(runState, testID);
                runState.started(testIndex, item.payload.instant.absolute);
                return;
            } else if (item.payload.kind === "testSkipped") {
                const testName = this.testName(item.payload.testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                runState.skipped(testIndex);
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

                // When running a single test the testEnded and testCaseEnded events
                // have the same ID, and so we'd end the same test twice.
                if (this.completionMap.get(testIndex)) {
                    return;
                }
                this.completionMap.set(testIndex, true);
                runState.completed(testIndex, { timestamp: item.payload.instant.absolute });
                return;
            } else if (item.payload.kind === "_valueAttached" && item.payload._attachment.path) {
                const testID = this.idFromOptionalTestCase(item.payload.testID);
                const testIndex = this.getTestCaseIndex(runState, testID);

                this.onAttachment(testIndex, item.payload._attachment.path);
                return;
            }
        }
    }
}

export class MessageRenderer {
    /**
     * Converts a swift-testing `EventMessage` to a printable string.
     *
     * @param message An event message, typically found on an `EventRecordPayload`.
     * @returns A string representing the message.
     */
    static render(message: EventMessage): string {
        return message.text;

        // Currently VS Code doesn't support colorizing the output of issues
        // shown inline in the editor. Until this is supported we just return
        // the message text. Once it is supported we can use the following code:
        // return `${SymbolRenderer.eventMessageSymbol(message.symbol)} ${MessageRenderer.colorize(message.symbol, message.text)}`;
    }

    private static colorize(symbolType: TestSymbol, message: string): string {
        const ansiEscapeCodePrefix = "\u{001B}[";
        const resetANSIEscapeCode = `${ansiEscapeCodePrefix}0m`;
        switch (symbolType) {
            case TestSymbol.details:
            case TestSymbol.skip:
            case TestSymbol.difference:
            case TestSymbol.passWithKnownIssue:
                return `${ansiEscapeCodePrefix}90m${message}${resetANSIEscapeCode}`;
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
    public static eventMessageSymbol(symbol: TestSymbol): string {
        return this.colorize(symbol, this.symbol(symbol));
    }

    static ansiEscapeCodePrefix = "\u{001B}[";
    static resetANSIEscapeCode = `${SymbolRenderer.ansiEscapeCodePrefix}0m`;

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
                    return "\u{279C}"; // Unicode: HEAVY ROUND-TIPPED RIGHTWARDS ARROW
                case TestSymbol.pass:
                    return "\u{221A}"; // Unicode: SQUARE ROOT
                case TestSymbol.difference:
                    return "\u{00B1}"; // Unicode: PLUS-MINUS SIGN
                case TestSymbol.warning:
                    return "\u{25B2}"; // Unicode: BLACK UP-POINTING TRIANGLE
                case TestSymbol.details:
                    return "\u{2192}"; // Unicode: RIGHTWARDS ARROW
                case TestSymbol.attachment:
                    return "\u{2399}"; // Unicode: PRINT SCREEN SYMBOL
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
                    return "\u{279C}"; // Unicode: HEAVY ROUND-TIPPED RIGHTWARDS ARROW
                case TestSymbol.pass:
                    return "\u{2714}"; // Unicode: HEAVY CHECK MARK
                case TestSymbol.difference:
                    return "\u{00B1}"; // Unicode: PLUS-MINUS SIGN
                case TestSymbol.warning:
                    return "\u{26A0}\u{FE0E}"; // Unicode: WARNING SIGN + VARIATION SELECTOR-15 (disable emoji)
                case TestSymbol.details:
                    return "\u{21B3}"; // Unicode: DOWNWARDS ARROW WITH TIP RIGHTWARDS
                case TestSymbol.attachment:
                    return "\u{2399}"; // Unicode: PRINT SCREEN SYMBOL
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
                return `${SymbolRenderer.ansiEscapeCodePrefix}90m${symbol}${SymbolRenderer.resetANSIEscapeCode}`;
            case TestSymbol.pass:
                return `${SymbolRenderer.ansiEscapeCodePrefix}92m${symbol}${SymbolRenderer.resetANSIEscapeCode}`;
            case TestSymbol.fail:
                return `${SymbolRenderer.ansiEscapeCodePrefix}91m${symbol}${SymbolRenderer.resetANSIEscapeCode}`;
            case TestSymbol.warning:
                return `${SymbolRenderer.ansiEscapeCodePrefix}93m${symbol}${SymbolRenderer.resetANSIEscapeCode}`;
            case TestSymbol.attachment:
                return `${SymbolRenderer.ansiEscapeCodePrefix}94m${symbol}${SymbolRenderer.resetANSIEscapeCode}`;
            case TestSymbol.none:
            default:
                return symbol;
        }
    }
}
