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

// All events produced by a swift-testing run will be one of these three types.
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
}

interface RunEnded {
    kind: "runEnded";
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
    _testCase: TestCase;
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
        sourceLocation: SourceLocation;
    };
}

export interface EventMessage {
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

    constructor(
        public testRunStarted: () => void,
        public addParameterizedTestCase: (testClass: TestClass, parentIndex: number) => void
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

        reader.start(readlinePipe);
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
        return testCase ? this.createTestCaseId(testCase) : testId;
    }

    // Test cases do not have a unique ID if their arguments are not serializable
    // with Codable. If they aren't, their id appears as `argumentIDs: nil`, and we
    // fall back to using the testCase display name as the test case ID. This isn't
    // ideal because its possible to have multiple test cases with the same display name,
    // but until we have a better solution for identifying test cases it will have to do.
    // SEE: rdar://119522099.
    private createTestCaseId(testCase: TestCase): string {
        return testCase.id === "argumentIDs: nil" ? testCase.displayName : testCase.id;
    }

    private parameterizedFunctionTestCaseToTestClass(
        testCase: TestCase,
        location: vscode.Location,
        index: number
    ): TestClass {
        return {
            id: this.createTestCaseId(testCase),
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
            map.set(this.createTestCaseId(testCase), testCase);
        });
        this.testCaseMap.set(record.payload.id, map);
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
                        testCase,
                        sourceLocationToVSCodeLocation(item.payload.sourceLocation),
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
            } else if (item.payload.kind === "testCaseStarted") {
                const testID = this.testCaseId(
                    item.payload.testID,
                    this.createTestCaseId(item.payload._testCase)
                );
                const testName = this.testName(testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                runState.started(testIndex, item.payload.instant.absolute);
            } else if (item.payload.kind === "testSkipped") {
                const testName = this.testName(item.payload.testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                runState.skipped(testIndex);
            } else if (item.payload.kind === "issueRecorded") {
                const testID = this.testCaseId(
                    item.payload.testID,
                    this.createTestCaseId(item.payload._testCase)
                );
                const testName = this.testName(testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                const location = sourceLocationToVSCodeLocation(item.payload.issue.sourceLocation);
                item.payload.messages.forEach(message => {
                    runState.recordIssue(testIndex, message.text, location);
                });

                if (testID !== item.payload.testID) {
                    const testName = this.testName(item.payload.testID);
                    const testIndex = runState.getTestItemIndex(testName, undefined);
                    item.payload.messages.forEach(message => {
                        runState.recordIssue(testIndex, message.text, location);
                    });
                }
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
            } else if (item.payload.kind === "testCaseEnded") {
                const testID = this.testCaseId(
                    item.payload.testID,
                    this.createTestCaseId(item.payload._testCase)
                );
                const testName = this.testName(testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);

                // When running a single test the testEnded and testCaseEnded events
                // have the same ID, and so we'd end the same test twice.
                if (this.completionMap.get(testIndex)) {
                    return;
                }
                this.completionMap.set(testIndex, true);
                runState.completed(testIndex, { timestamp: item.payload.instant.absolute });
            }
        }
    }
}

function sourceLocationToVSCodeLocation(sourceLocation: SourceLocation): vscode.Location {
    return new vscode.Location(
        vscode.Uri.file(sourceLocation._filePath),
        new vscode.Position(sourceLocation.line - 1, sourceLocation?.column ?? 0)
    );
}
