import * as readline from "readline";
import { Readable } from "stream";
import {
    INamedPipeReader,
    UnixNamedPipeReader,
    WindowsNamedPipeReader,
} from "./TestEventStreamReader";
import { ITestRunState } from "./TestRunState";

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
    payload: Test;
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

interface Test {
    kind: "suite" | "function" | "parameterizedFunction";
    id: string;
    name: string;
    testCases?: TestCase[];
    sourceLocation: SourceLocation;
}

interface TestCase {
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

interface BaseEvent {
    timestamp: number;
    messages: EventMessage[];
    testID: string;
}

interface TestStarted extends BaseEvent {
    kind: "testStarted";
}

interface TestEnded extends BaseEvent {
    kind: "testEnded";
}

interface TestCaseStarted extends BaseEvent {
    kind: "testCaseStarted";
}

interface TestCaseEnded extends BaseEvent {
    kind: "testCaseEnded";
}

interface TestSkipped extends BaseEvent {
    kind: "testSkipped";
}

interface IssueRecorded extends BaseEvent {
    kind: "issueRecorded";
    sourceLocation: SourceLocation;
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

    private parse(item: SwiftTestEvent, runState: ITestRunState) {
        if (item.kind === "event") {
            if (item.payload.kind === "testCaseStarted" || item.payload.kind === "testStarted") {
                const testName = this.testName(item.payload.testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                runState.started(testIndex, item.payload.timestamp);
            } else if (item.payload.kind === "testSkipped") {
                const testName = this.testName(item.payload.testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                runState.skipped(testIndex);
            } else if (item.payload.kind === "issueRecorded") {
                const testName = this.testName(item.payload.testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                const sourceLocation = item.payload.sourceLocation;
                item.payload.messages.forEach(message => {
                    runState.recordIssue(testIndex, message.text, {
                        file: sourceLocation._filePath,
                        line: sourceLocation.line,
                        column: sourceLocation.column,
                    });
                });
            } else if (item.payload.kind === "testCaseEnded" || item.payload.kind === "testEnded") {
                const testName = this.testName(item.payload.testID);
                const testIndex = runState.getTestItemIndex(testName, undefined);
                runState.completed(testIndex, { timestamp: item.payload.timestamp });
            }
        }
    }
}
