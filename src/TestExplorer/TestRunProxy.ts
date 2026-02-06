//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { TestCoverage } from "../coverage/LcovResults";
import { CompositeCancellationToken } from "../utilities/cancellation";
import { compactMap } from "../utilities/utilities";
import { TestClass, runnableTag, upsertTestItem } from "./TestDiscovery";
import { SymbolRenderer, TestSymbol } from "./TestParsers/SwiftTestingOutputParser";
import { TestRunArguments } from "./TestRunArguments";
import { TestLibrary } from "./TestRunner";
import { reduceTestItemChildren } from "./TestUtils";

// eslint-disable-next-line @typescript-eslint/no-require-imports
import stripAnsi = require("strip-ansi");

/**
 * Test only structure that stores the state of test items.
 */
export class TestRunState {
    public pending: vscode.TestItem[] = [];
    public failed: {
        test: vscode.TestItem;
        message: vscode.TestMessage | readonly vscode.TestMessage[];
    }[] = [];
    public passed: vscode.TestItem[] = [];
    public skipped: vscode.TestItem[] = [];
    public enqueued = new Set<vscode.TestItem>();
    public unknown: number = 0;
    public output: string[] = [];
}

/**
 * The TestRunProxy acts as the data store for test results during a test run, and is responsible
 * for moving the underlying `vscode.TestItems` through from the `enqueued` state to one of passed,
 * failed or skipped.
 */
export class TestRunProxy implements vscode.CancellationToken {
    private testRun?: vscode.TestRun;
    private token: CompositeCancellationToken;
    private runStarted: boolean = false;
    private queuedOutput: string[] = [];
    private iteration: number | undefined;
    private attachments: { [key: string]: string[] } = {};
    private testItemFinder: TestItemFinder;
    private testRunCompleteEmitter = new vscode.EventEmitter<void>();
    private coverage: TestCoverage;
    private _testItems: vscode.TestItem[];

    /**
     * The list of test items for this test run
     **/
    public get testItems(): vscode.TestItem[] {
        return this._testItems;
    }

    /**
     * Captures the state of the underlying `vscode.TestItem`s, which can
     * then be verified in tests. Used in the extension's integration tests
     * to validate that tests pass/fail/skip as expected.
     */
    public runState = new TestRunState();

    /**
     * Is `true` when the test run has been cancelled, `false` otherwise.
     */
    public get isCancellationRequested(): boolean {
        return this.token.isCancellationRequested;
    }

    /**
     * An {@link Event} which fires upon cancellation.
     */
    public onCancellationRequested: vscode.Event<unknown>;

    /**
     * An {@link Event} which fires when the test run has completed.
     */
    public onTestRunComplete: vscode.Event<void>;

    /**
     * Creates a new TestRunProxy that captures the state of individual test items during
     * a test run, as well as any output and test coverage information.
     * @param testRunRequest The `vscode.TestRunRequest` that initiated the test run
     * @param controller The `vscode.TestController` that contains `vscode.TestItems`
     * @param args Arguments for the test run, indicating the individual tests to run.
     * @param folderContext The `FolderContext` for the folder that contains the tests.
     * @param recordDuration Whether or not to record the duration
     * @param testProfileCancellationToken A cancellation token for the test run
     */
    constructor(
        private testRunRequest: vscode.TestRunRequest,
        private controller: vscode.TestController,
        private args: TestRunArguments,
        private folderContext: FolderContext,
        private recordDuration: boolean,
        testProfileCancellationToken: vscode.CancellationToken
    ) {
        this._testItems = args.testItems;
        this.coverage = new TestCoverage(folderContext);
        this.token = new CompositeCancellationToken(testProfileCancellationToken);
        this.onCancellationRequested = this.token.onCancellationRequested.bind(this.token);
        this.testItemFinder =
            process.platform === "darwin"
                ? new DarwinTestItemFinder(args.testItems)
                : new NonDarwinTestItemFinder(args.testItems, this.folderContext);
        this.onTestRunComplete = this.testRunCompleteEmitter.event;
    }

    /**
     * Begins the test run. Test items that have been added are moved to the `enqued` state.
     */
    public testRunStarted() {
        if (this.runStarted) {
            return;
        }

        this.runStarted = true;
        this.resetTags(this.controller);

        this.testRun = this.controller.createTestRun(this.testRunRequest);
        this.token.add(this.testRun.token);

        // Forward any output captured before the testRun was created.
        for (const outputLine of this.queuedOutput) {
            this.performAppendOutput(outputLine);
        }
        this.queuedOutput = [];

        for (const test of this.testItems) {
            this.enqueued(test);
        }
    }

    /**
     * Adds a parameterized test case (a swift-testing only concept). Parameterized test cases are
     * discovered at run time, and are linked to a parent test class.
     * @param testClasses A list of parameterized tests to add
     * @param parentIndex The index of the parent `vscode.TestItem`
     */
    public addParameterizedTestCases(testClasses: TestClass[], parentIndex: number) {
        const addedTestItems = testClasses
            .map(testClass => {
                const parent = this.args.testItems[parentIndex];
                // clear out the children before we add the new ones.
                parent.children.replace([]);
                return {
                    testClass,
                    parent,
                };
            })
            .map(({ testClass, parent }) => {
                // strip the location off parameterized tests so only the parent TestItem
                // has one. The parent collects all the issues so they're colated on the top
                // level test item and users can cycle through them with the up/down arrows in the UI.
                testClass.location = undefined;

                // Results should inherit any tags from the parent.
                // Until we can rerun a swift-testing test with an individual argument, mark
                // the argument test items as not runnable. This should be revisited when
                // https://github.com/swiftlang/swift-testing/issues/671 is resolved.
                testClass.tags = compactMap(parent.tags, t =>
                    t.id === runnableTag.id ? null : new vscode.TestTag(t.id)
                ).concat(new vscode.TestTag(TestRunProxy.Tags.PARAMETERIZED_TEST_RESULT));

                const added = upsertTestItem(this.controller, testClass, parent);

                // If we just update leaf nodes the root test controller never realizes that
                // items have updated. This may be a bug in VS Code. We can work around it by
                // re-adding the existing items back up the chain to refresh all the nodes along the way.
                let p = parent;
                while (p?.parent) {
                    p.parent.children.add(p);
                    p = p.parent;
                }

                return added;
            });
        this._testItems = [...this.testItems, ...addedTestItems];

        for (const test of addedTestItems) {
            this.enqueued(test);
        }

        // Recreate a test item finder with the added test items
        this.testItemFinder =
            process.platform === "darwin"
                ? new DarwinTestItemFinder(this.testItems)
                : new NonDarwinTestItemFinder(this.testItems, this.folderContext);
    }

    /**
     * Associates an attachment with a test item. Attachments are created during
     * a test run by individual tests. Attachment are provided as paths to individual
     * attachments stored on disk.
     * @param testIndex The index of the vscode.TestItem that produced the attachment
     * @param attachment The path to the attachment
     */
    public addAttachment(testIndex: number, attachment: string) {
        const attachments = this.attachments[testIndex] ?? [];
        attachments.push(attachment);
        this.attachments[testIndex] = attachments;

        const testItem = this.testItems[testIndex];
        if (testItem) {
            testItem.tags = [
                ...testItem.tags,
                new vscode.TestTag(TestRunProxy.Tags.HAS_ATTACHMENT),
            ];
        }
    }

    /**
     * Returns the index for the given test.
     * @param id The index for the given test
     * @param filename An optional filename of the file that contains the test, used for disambiguation.
     **/
    public getTestIndex(id: string, filename?: string): number {
        return this.testItemFinder.getIndex(id, filename);
    }

    /**
     * Captures that an unknown test ran. This should not be called if functionality
     * is working as expected, and the extension's tests assert that this function
     * was not called during test runs.
     */
    public unknownTestRan() {
        this.runState.unknown++;
    }

    /**
     * Indicates the supplied test has started running.
     * @param test The test that started
     */
    public started(test: vscode.TestItem) {
        this.clearEnqueuedTest(test);
        this.runState.pending.push(test);
        this.testRun?.started(test);
    }

    /**
     * Indicates the supplied test was skipped.
     * @param test The test that was skipped
     */
    public skipped(test: vscode.TestItem) {
        this.clearEnqueuedTest(test);
        test.tags = [...test.tags, new vscode.TestTag(TestRunProxy.Tags.SKIPPED)];

        this.runState.skipped.push(test);
        this.clearPendingTest(test);
        this.testRun?.skipped(test);
    }

    /**
     * Indicates the supplied test passed.
     * @param test The test that passed
     * @param duration How long the test took to execute, in milliseconds.
     */
    public passed(test: vscode.TestItem, duration?: number) {
        this.clearEnqueuedTest(test);
        this.runState.passed.push(test);
        this.clearPendingTest(test);
        this.testRun?.passed(test, this.recordDuration ? duration : undefined);
    }

    /**
     * Indicates the supplied test failed.
     * @param test The test that failed
     * @param message The cause, or causes of the test failure
     * @param duration How long the test took to execute, in milliseconds.
     */
    public failed(
        test: vscode.TestItem,
        message: vscode.TestMessage | readonly vscode.TestMessage[],
        duration?: number
    ) {
        this.clearEnqueuedTest(test);
        this.runState.failed.push({ test, message });
        this.clearPendingTest(test);
        this.testRun?.failed(test, message, this.recordDuration ? duration : undefined);
    }

    /**
     * Skip any pending tests.
     * Call this method when a test run is cancelled to mark the pending tests as skipped.
     * Otherwise, pending tests will be marked as failing as we assume they crashed.
     */
    public skipPendingTests() {
        this.runState.pending.forEach(test => {
            this.skipped(test);
        });
        this.runState.pending = [];
    }

    /**
     * Completes the test run. Once the `end` method is called, test
     * results will no longer be captured and any remaining pending tests
     * will be marked as failed, and any enqueued tests will be marked as skipped.
     */
    public async end() {
        // If the test run never started (typically due to a build error)
        // start it to flush any queued output, and then immediately end it.
        if (!this.runStarted) {
            this.testRunStarted();
        }

        // Any tests still in the pending state are considered failed. This
        // can happen if a test causes a crash and aborts the test run.
        this.markPendingAsFailed();

        // If there are tests that never started, mark them as skipped.
        // This can happen if there is a build error preventing tests from running.
        this.markEnqueuedAsSkipped();

        // Capture and report attachments to the test output panel
        this.reportAttachments();

        // Finally, mark the underlying test run as ended.
        this.testRun?.end();
        this.testRunCompleteEmitter.fire();
        this.token.dispose();
    }

    /**
     * Set the iteration of the test run. Used when performing a test run multiple times.
     * @param iteration The iteration number
     */
    public setIteration(iteration: number) {
        this.runState = new TestRunState();
        this.iteration = iteration;
        if (this.testRun) {
            this.performAppendOutput("\n\r");
        }
    }

    /**
     * Returns coverage information for the suppplied URI.
     */
    public loadDetailedCoverage(uri: vscode.Uri) {
        return this.coverage.loadDetailedCoverage(uri);
    }

    /**
     * Captures coverage information out of the build folder for
     * the supplied test library. This should be called after the
     * test run is complete and the `end` method has been called.
     * @param testLibrary The test library to capture coverage for
     */
    public captureCoverage(testLibrary: TestLibrary) {
        return this.coverage.captureCoverage(testLibrary);
    }

    /**
     * Compute final coverage numbers if any coverage info has been captured during the run.
     */
    public async computeCoverage() {
        if (!this.testRun) {
            return;
        }

        await this.coverage.computeCoverage(this.testRun);
    }

    /**
     * Append output to the test run. This output is shown in the Test Results panel.
     */
    public appendOutput(output: string) {
        this.performAppendOutput(output);
    }

    /**
     * Append output to the test run. This output is shown in the Test Results panel, and
     * is associated with the supplied `vscode.TestItem`.
     * @param output Output to append to the test results.
     * @param test The test to associate with the output.
     * @param location Optional location of the test that produced the output.
     */
    public appendOutputToTest(output: string, test: vscode.TestItem, location?: vscode.Location) {
        this.performAppendOutput(output, test, location);
    }

    private enqueued(test: vscode.TestItem) {
        this.testRun?.enqueued(test);
        this.runState.enqueued.add(test);
    }

    private markPendingAsFailed() {
        this.runState.pending.forEach(test => {
            this.failed(test, new vscode.TestMessage("Test did not complete."));
        });
    }

    private markEnqueuedAsSkipped() {
        this.runState.enqueued.forEach(test => {
            // Omit adding the root test item as a skipped test to keep just the suites/tests
            // in the test run output, just like a regular pass/fail test run.
            if (test.parent) {
                for (const output of this.queuedOutput) {
                    this.appendOutputToTest(output, test);
                }
                this.skipped(test);
            }
        });

        this.queuedOutput = [];
    }

    private clearPendingTest(test: vscode.TestItem) {
        this.runState.pending = this.runState.pending.filter(t => t !== test);
    }

    private clearEnqueuedTest(test: vscode.TestItem) {
        this.runState.enqueued.delete(test);

        if (!test.parent) {
            return;
        }

        const parentHasEnqueuedChildren = Array.from(test.parent.children).some(([_, child]) =>
            this.runState.enqueued.has(child)
        );

        if (!parentHasEnqueuedChildren) {
            this.clearEnqueuedTest(test.parent);
        }
    }

    private performAppendOutput(
        output: string,
        test?: vscode.TestItem,
        location?: vscode.Location
    ) {
        const tranformedOutput = this.prependIterationToOutput(output);
        if (this.testRun) {
            this.testRun.appendOutput(output, location, test);
            this.runState.output.push(stripAnsi(output));
        } else {
            this.queuedOutput.push(tranformedOutput);
        }
    }

    private prependIterationToOutput(output: string): string {
        if (this.iteration === undefined) {
            return output;
        }
        const itr = this.iteration + 1;
        const lines = output.match(/[^\r\n]*[\r\n]*/g);
        return lines?.map(line => (line ? `\x1b[34mRun ${itr}\x1b[0m ${line}` : "")).join("") ?? "";
    }

    private reportAttachments() {
        const attachmentKeys = Object.keys(this.attachments);
        if (attachmentKeys.length > 0) {
            let attachment = "";
            const totalAttachments = attachmentKeys.reduce((acc, key) => {
                const attachments = this.attachments[key];
                attachment = attachments.length ? attachments[0] : attachment;
                return acc + attachments.length;
            }, 0);

            if (attachment) {
                attachment = path.dirname(attachment);
                this.appendOutput(
                    `${SymbolRenderer.eventMessageSymbol(TestSymbol.attachment)} ${SymbolRenderer.ansiEscapeCodePrefix}90mRecorded ${totalAttachments} attachment${totalAttachments === 1 ? "" : "s"} to ${attachment}${SymbolRenderer.resetANSIEscapeCode}`
                );
            }
        }
    }

    /**
     * Extra tags automatically applied by the extension to `vscode.TestItems`.
     */
    static Tags = {
        SKIPPED: "skipped",
        HAS_ATTACHMENT: "hasAttachment",
        PARAMETERIZED_TEST_RESULT: "parameterizedTestResult",
    };

    // Remove any tags that were added due to test results
    private resetTags(controller: vscode.TestController) {
        function removeTestRunTags(_acc: void, test: vscode.TestItem) {
            const tags = Object.values(TestRunProxy.Tags);
            test.tags = test.tags.filter(tag => !tags.includes(tag.id));
        }
        reduceTestItemChildren(controller.items, removeTestRunTags, void 0);
    }
}

/** Interface defining how to find test items given a test id from XCTest output */
interface TestItemFinder {
    getIndex(id: string, filename?: string): number;
    testItems: vscode.TestItem[];
}

/** Defines how to find test items given a test id from XCTest output on Darwin platforms */
class DarwinTestItemFinder implements TestItemFinder {
    private readonly testItemMap: Map<string, number>;

    constructor(public testItems: vscode.TestItem[]) {
        this.testItemMap = new Map(testItems.map((item, index) => [item.id, index]));
    }

    getIndex(id: string): number {
        return this.testItemMap.get(id) ?? -1;
    }
}

/** Defines how to find test items given a test id from XCTest output on non-Darwin platforms */
class NonDarwinTestItemFinder implements TestItemFinder {
    constructor(
        public testItems: vscode.TestItem[],
        public folderContext: FolderContext
    ) {}

    /**
     * Get test item index from id for non Darwin platforms. It is a little harder to
     * be certain we have the correct test item on non Darwin platforms as the target
     * name is not included in the id
     */
    getIndex(id: string, filename?: string): number {
        let testIndex = -1;
        if (filename) {
            testIndex = this.testItems.findIndex(item =>
                this.isTestWithFilenameInTarget(id, filename, item)
            );
        }

        if (testIndex === -1) {
            testIndex = this.testItems.findIndex(item => item.id.endsWith(id));
        }

        return testIndex;
    }

    /**
     * Linux test output does not include the target name. So I have to work out which target
     * the test is in via the test name and if it failed the filename from the error. In theory
     * if a test fails the filename for where it failed should indicate which target it is in.
     *
     * @param testName Test name
     * @param filename File name of where test failed
     * @param item TestItem
     * @returns Is it this TestItem
     */
    private isTestWithFilenameInTarget(
        testName: string,
        filename: string,
        item: vscode.TestItem
    ): boolean {
        if (!item.id.endsWith(testName)) {
            return false;
        }

        // get target test item
        const targetTestItem = item.parent?.parent;
        if (!targetTestItem) {
            return false;
        }

        // get target from Package
        const target = this.folderContext.swiftPackage.currentTargets.find(
            item => targetTestItem.label === item.name
        );

        if (target) {
            const fileErrorIsIn = filename;
            const targetPath = path.join(this.folderContext.folder.fsPath, target.path);
            const relativePath = path.relative(targetPath, fileErrorIsIn);
            return target.sources.find(source => source === relativePath) !== undefined;
        }

        return false;
    }
}
