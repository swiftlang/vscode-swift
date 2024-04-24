import { MarkdownString } from "vscode";

/**
 * Interface for setting this test runs state
 */
export interface ITestRunState {
    // excess data from previous parse that was not processed
    excess?: string;
    // failed test state
    failedTest?: {
        testIndex: number;
        message: string;
        file: string;
        lineNumber: number;
        complete: boolean;
    };

    // get test item index from test name on non Darwin platforms
    getTestItemIndex(id: string, filename: string | undefined): number;

    // set test index to be started
    started(index: number, startTime?: number): void;

    // set test index to have passed.
    // If a start time was provided to `started` then the duration is computed as endTime - startTime,
    // otherwise the time passed is assumed to be the duration.
    completed(index: number, timing: { duration: number } | { timestamp: number }): void;

    // record an issue against a test
    recordIssue(
        index: number,
        message: string | MarkdownString,
        location?: { file: string; line: number; column?: number }
    ): void;

    // set test index to have been skipped
    skipped(index: number): void;

    // started suite
    startedSuite(name: string): void;

    // passed suite
    passedSuite(name: string): void;

    // failed suite
    failedSuite(name: string): void;
}
