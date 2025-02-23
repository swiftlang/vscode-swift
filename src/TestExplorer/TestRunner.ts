//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as path from "path";
import * as stream from "stream";
import * as os from "os";
import * as asyncfs from "fs/promises";
import { FolderContext } from "../FolderContext";
import { compactMap, execFile, getErrorDescription } from "../utilities/utilities";
import { createSwiftTask } from "../tasks/SwiftTaskProvider";
import configuration from "../configuration";
import { WorkspaceContext } from "../WorkspaceContext";
import {
    IXCTestOutputParser,
    ParallelXCTestOutputParser,
    XCTestOutputParser,
} from "./TestParsers/XCTestOutputParser";
import {
    SwiftTestingOutputParser,
    SymbolRenderer,
    TestSymbol,
} from "./TestParsers/SwiftTestingOutputParser";
import { LoggingDebugAdapterTracker } from "../debugger/logTracker";
import { TaskOperation } from "../tasks/TaskQueue";
import { TestXUnitParser } from "./TestXUnitParser";
import { ITestRunState, TestIssueDiff } from "./TestParsers/TestRunState";
import { TestRunArguments } from "./TestRunArguments";
import { TemporaryFolder } from "../utilities/tempFolder";
import { TestClass, runnableTag, upsertTestItem } from "./TestDiscovery";
import { TestCoverage } from "../coverage/LcovResults";
import {
    BuildConfigurationFactory,
    SwiftTestingBuildAguments,
    SwiftTestingConfigurationSetup,
    TestingConfigurationFactory,
} from "../debugger/buildConfig";
import { TestKind, isDebugging, isRelease } from "./TestKind";
import { reduceTestItemChildren } from "./TestUtils";
import { CompositeCancellationToken } from "../utilities/cancellation";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import stripAnsi = require("strip-ansi");

export enum TestLibrary {
    xctest = "XCTest",
    swiftTesting = "swift-testing",
}

export interface TestRunState {
    failed: {
        test: vscode.TestItem;
        message: vscode.TestMessage | readonly vscode.TestMessage[];
    }[];
    passed: vscode.TestItem[];
    skipped: vscode.TestItem[];
    errored: vscode.TestItem[];
    unknown: number;
    output: string[];
}

export class TestRunProxy {
    private testRun?: vscode.TestRun;
    private addedTestItems: { testClass: TestClass; parentIndex: number }[] = [];
    private runStarted: boolean = false;
    private queuedOutput: string[] = [];
    private _testItems: vscode.TestItem[];
    private iteration: number | undefined;
    private attachments: { [key: string]: string[] } = {};
    public coverage: TestCoverage;
    public token: CompositeCancellationToken;

    public testRunCompleteEmitter = new vscode.EventEmitter<void>();
    public onTestRunComplete: vscode.Event<void>;

    // Allows for introspection on the state of TestItems after a test run.
    public runState = TestRunProxy.initialTestRunState();

    public static initialTestRunState(): TestRunState {
        return {
            failed: [],
            passed: [],
            skipped: [],
            errored: [],
            unknown: 0,
            output: [],
        };
    }

    public get testItems(): vscode.TestItem[] {
        return this._testItems;
    }

    public get isCancellationRequested(): boolean {
        return this.token.isCancellationRequested;
    }

    constructor(
        private testRunRequest: vscode.TestRunRequest,
        private controller: vscode.TestController,
        private args: TestRunArguments,
        private folderContext: FolderContext,
        testProfileCancellationToken: vscode.CancellationToken
    ) {
        this._testItems = args.testItems;
        this.coverage = new TestCoverage(folderContext);
        this.token = new CompositeCancellationToken(testProfileCancellationToken);
        this.onTestRunComplete = this.testRunCompleteEmitter.event;
    }

    public testRunStarted = () => {
        if (this.runStarted) {
            return;
        }
        this.runStarted = true;

        // When a test run starts we need to do several things:
        // - Create new TestItems for each paramterized test that was added
        //   and attach them to their parent TestItem.
        // - Create a new test run from the TestRunArguments + newly created TestItems.
        // - Mark all of these test items as enqueued on the test run.

        const addedTestItems = this.addedTestItems
            .map(({ testClass, parentIndex }) => {
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
                );

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

        this.testRun = this.controller.createTestRun(this.testRunRequest);
        this.token.add(this.testRun.token);
        this._testItems = [...this.testItems, ...addedTestItems];

        // Forward any output captured before the testRun was created.
        for (const outputLine of this.queuedOutput) {
            this.performAppendOutput(this.testRun, outputLine);
        }
        this.queuedOutput = [];

        for (const test of this.testItems) {
            this.testRun.enqueued(test);
        }
    };

    public addParameterizedTestCase = (testClass: TestClass, parentIndex: number) => {
        this.addedTestItems.push({ testClass, parentIndex });
    };

    public addAttachment = (testIndex: number, attachment: string) => {
        const attachments = this.attachments[testIndex] ?? [];
        attachments.push(attachment);
        this.attachments[testIndex] = attachments;
    };

    public getTestIndex(id: string, filename?: string): number {
        return this.testItemFinder.getIndex(id, filename);
    }

    private get testItemFinder(): TestItemFinder {
        if (process.platform === "darwin") {
            return new DarwinTestItemFinder(this.testItems);
        } else {
            return new NonDarwinTestItemFinder(this.testItems, this.folderContext);
        }
    }

    public unknownTestRan() {
        this.runState.unknown++;
    }

    public started(test: vscode.TestItem) {
        this.testRun?.started(test);
    }

    public skipped(test: vscode.TestItem) {
        this.runState.skipped.push(test);
        this.testRun?.skipped(test);
    }

    public passed(test: vscode.TestItem, duration?: number) {
        this.runState.passed.push(test);
        this.testRun?.passed(test, duration);
    }

    public failed(
        test: vscode.TestItem,
        message: vscode.TestMessage | readonly vscode.TestMessage[],
        duration?: number
    ) {
        this.runState.failed.push({ test, message });
        this.testRun?.failed(test, message, duration);
    }

    public errored(
        test: vscode.TestItem,
        message: vscode.TestMessage | readonly vscode.TestMessage[],
        duration?: number
    ) {
        this.runState.errored.push(test);
        this.testRun?.errored(test, message, duration);
    }

    public async end() {
        // If the test run never started (typically due to a build error)
        // start it to flush any queued output, and then immediately end it.
        if (!this.runStarted) {
            this.testRunStarted();
        }

        this.reportAttachments();
        this.testRun?.end();
        this.testRunCompleteEmitter.fire();
        this.token.dispose();
    }

    public setIteration(iteration: number) {
        this.runState = TestRunProxy.initialTestRunState();
        this.iteration = iteration;
    }

    public appendOutput(output: string) {
        const tranformedOutput = this.prependIterationToOutput(output);
        if (this.testRun) {
            this.performAppendOutput(this.testRun, tranformedOutput);
        } else {
            this.queuedOutput.push(tranformedOutput);
        }
    }

    public appendOutputToTest(output: string, test: vscode.TestItem, location?: vscode.Location) {
        const tranformedOutput = this.prependIterationToOutput(output);
        if (this.testRun) {
            this.performAppendOutput(this.testRun, tranformedOutput, location, test);
        } else {
            this.queuedOutput.push(tranformedOutput);
        }
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

    private performAppendOutput(
        testRun: vscode.TestRun,
        output: string,
        location?: vscode.Location,
        test?: vscode.TestItem
    ) {
        testRun.appendOutput(output, location, test);
        this.runState.output.push(stripAnsi(output));
    }

    private prependIterationToOutput(output: string): string {
        if (this.iteration === undefined) {
            return output;
        }
        const itr = this.iteration + 1;
        const lines = output.match(/[^\r\n]*[\r\n]*/g);
        return lines?.map(line => (line ? `\x1b[34mRun ${itr}\x1b[0m ${line}` : "")).join("") ?? "";
    }

    public async computeCoverage() {
        if (!this.testRun) {
            return;
        }

        // Compute final coverage numbers if any coverage info has been captured during the run.
        await this.coverage.computeCoverage(this.testRun);
    }
}

/** Class used to run tests */
export class TestRunner {
    public testRun: TestRunProxy;
    private testArgs: TestRunArguments;
    private xcTestOutputParser: IXCTestOutputParser;
    private swiftTestOutputParser: SwiftTestingOutputParser;

    /**
     * Constructor for TestRunner
     * @param request Test run request
     * @param folderContext Folder tests are being run in
     * @param controller Test controller
     */
    constructor(
        private testKind: TestKind,
        private request: vscode.TestRunRequest,
        private folderContext: FolderContext,
        private controller: vscode.TestController,
        token: vscode.CancellationToken
    ) {
        this.testArgs = new TestRunArguments(
            this.ensureRequestIncludesTests(this.request),
            isDebugging(testKind)
        );
        this.testRun = new TestRunProxy(request, controller, this.testArgs, folderContext, token);
        this.xcTestOutputParser =
            testKind === TestKind.parallel
                ? new ParallelXCTestOutputParser(
                      this.folderContext.workspaceContext.toolchain.hasMultiLineParallelTestOutput
                  )
                : new XCTestOutputParser();
        this.swiftTestOutputParser = new SwiftTestingOutputParser(
            this.testRun.testRunStarted,
            this.testRun.addParameterizedTestCase,
            this.testRun.addAttachment
        );
    }

    /**
     * When performing a "Run test multiple times" run set the iteration
     * so it can be shown in the logs.
     * @param iteration The iteration counter
     */
    public setIteration(iteration: number) {
        // The SwiftTestingOutputParser holds state and needs to be reset between iterations.
        this.swiftTestOutputParser = new SwiftTestingOutputParser(
            this.testRun.testRunStarted,
            this.testRun.addParameterizedTestCase,
            this.testRun.addAttachment
        );
        this.testRun.setIteration(iteration);
    }

    /**
     * If the request has no test items to include in the run,
     * default to using all the items in the `TestController`.
     */
    private ensureRequestIncludesTests(request: vscode.TestRunRequest): vscode.TestRunRequest {
        if ((request.include?.length ?? 0) > 0) {
            return request;
        }
        const items: vscode.TestItem[] = [];
        this.controller.items.forEach(item => items.push(item));
        return new vscode.TestRunRequest(items, request.exclude, request.profile);
    }

    get workspaceContext(): WorkspaceContext {
        return this.folderContext.workspaceContext;
    }

    /**
     * Setup debug and run test profiles
     * @param controller Test controller
     * @param folderContext Folder tests are running in
     */
    static setupProfiles(
        controller: vscode.TestController,
        folderContext: FolderContext,
        onCreateTestRun: vscode.EventEmitter<TestRunProxy>
    ): vscode.TestRunProfile[] {
        return [
            // Add non-debug profiles
            controller.createRunProfile(
                TestKind.standard,
                vscode.TestRunProfileKind.Run,
                async (request, token) => {
                    const runner = new TestRunner(
                        TestKind.standard,
                        request,
                        folderContext,
                        controller,
                        token
                    );
                    onCreateTestRun.fire(runner.testRun);
                    await runner.runHandler();
                },
                true,
                runnableTag
            ),
            controller.createRunProfile(
                TestKind.parallel,
                vscode.TestRunProfileKind.Run,
                async (request, token) => {
                    const runner = new TestRunner(
                        TestKind.parallel,
                        request,
                        folderContext,
                        controller,
                        token
                    );
                    onCreateTestRun.fire(runner.testRun);
                    await runner.runHandler();
                },
                false,
                runnableTag
            ),
            controller.createRunProfile(
                TestKind.release,
                vscode.TestRunProfileKind.Run,
                async (request, token) => {
                    const runner = new TestRunner(
                        TestKind.release,
                        request,
                        folderContext,
                        controller,
                        token
                    );
                    onCreateTestRun.fire(runner.testRun);
                    await runner.runHandler();
                },
                false,
                runnableTag
            ),
            // Add coverage profile
            controller.createRunProfile(
                TestKind.coverage,
                vscode.TestRunProfileKind.Coverage,
                async (request, token) => {
                    const runner = new TestRunner(
                        TestKind.coverage,
                        request,
                        folderContext,
                        controller,
                        token
                    );
                    onCreateTestRun.fire(runner.testRun);
                    if (request.profile) {
                        request.profile.loadDetailedCoverage = async (_testRun, fileCoverage) => {
                            return runner.testRun.coverage.loadDetailedCoverage(fileCoverage.uri);
                        };
                    }
                    await runner.runHandler();
                    await vscode.commands.executeCommand("testing.openCoverage");
                },
                false,
                runnableTag
            ),
            // Add debug profile
            controller.createRunProfile(
                TestKind.debug,
                vscode.TestRunProfileKind.Debug,
                async (request, token) => {
                    const runner = new TestRunner(
                        TestKind.debug,
                        request,
                        folderContext,
                        controller,
                        token
                    );
                    onCreateTestRun.fire(runner.testRun);
                    await runner.runHandler();
                },
                false,
                runnableTag
            ),
            controller.createRunProfile(
                TestKind.debugRelease,
                vscode.TestRunProfileKind.Debug,
                async (request, token) => {
                    const runner = new TestRunner(
                        TestKind.debugRelease,
                        request,
                        folderContext,
                        controller,
                        token
                    );
                    onCreateTestRun.fire(runner.testRun);
                    await runner.runHandler();
                },
                false,
                runnableTag
            ),
        ];
    }

    /**
     * Test run handler. Run a series of tests and extracts the results from the output
     * @param shouldDebug Should we run the debugger
     * @param token Cancellation token
     * @returns When complete
     */
    async runHandler() {
        const runState = new TestRunnerTestRunState(this.testRun);

        const cancellationDisposable = this.testRun.token.onCancellationRequested(() => {
            this.testRun.appendOutput("\r\nTest run cancelled.");
        });

        try {
            if (isDebugging(this.testKind)) {
                await this.debugSession(runState);
            } else {
                await this.runSession(runState);
            }
        } catch (error) {
            this.workspaceContext.outputChannel.log(`Error: ${getErrorDescription(error)}`);
            this.testRun.appendOutput(`\r\nError: ${getErrorDescription(error)}`);
        }

        // Coverage must be computed before the testRun is ended as of VS Code 1.90.0
        if (this.testKind === TestKind.coverage) {
            await this.testRun.computeCoverage();
        }

        cancellationDisposable.dispose();
        await this.testRun.end();
    }

    /** Run test session without attaching to a debugger */
    async runSession(runState: TestRunnerTestRunState): Promise<TestRunState> {
        // Run swift-testing first, then XCTest.
        // swift-testing being parallel by default should help these run faster.
        if (this.testArgs.hasSwiftTestingTests) {
            const testRunTime = Date.now();
            const fifoPipePath = this.generateFifoPipePath(testRunTime);

            await TemporaryFolder.withNamedTemporaryFiles([fifoPipePath], async () => {
                // macOS/Linux require us to create the named pipe before we use it.
                // Windows just lets us communicate by specifying a pipe path without any ceremony.
                if (process.platform !== "win32") {
                    await execFile("mkfifo", [fifoPipePath], undefined, this.folderContext);
                }
                // Create the swift-testing configuration JSON file, peparing any
                // directories the configuration may require.
                const attachmentFolder = await SwiftTestingConfigurationSetup.setupAttachmentFolder(
                    this.folderContext,
                    testRunTime
                );
                const swiftTestingArgs = await SwiftTestingBuildAguments.build(
                    fifoPipePath,
                    attachmentFolder
                );
                const testBuildConfig = await TestingConfigurationFactory.swiftTestingConfig(
                    this.folderContext,
                    swiftTestingArgs,
                    this.testKind,
                    this.testArgs.swiftTestArgs,
                    true
                );

                if (testBuildConfig === null || this.testRun.isCancellationRequested) {
                    return this.testRun.runState;
                }

                const outputStream = this.testOutputWritable(TestLibrary.swiftTesting, runState);

                // Watch the pipe for JSONL output and parse the events into test explorer updates.
                // The await simply waits for the watching to be configured.
                await this.swiftTestOutputParser.watch(fifoPipePath, runState);

                await this.launchTests(
                    runState,
                    this.testKind === TestKind.parallel ? TestKind.standard : this.testKind,
                    outputStream,
                    testBuildConfig,
                    TestLibrary.swiftTesting
                );

                await SwiftTestingConfigurationSetup.cleanupAttachmentFolder(
                    this.folderContext,
                    testRunTime,
                    this.workspaceContext.outputChannel
                );
            });
        }

        if (this.testArgs.hasXCTests) {
            const testBuildConfig = await TestingConfigurationFactory.xcTestConfig(
                this.folderContext,
                this.testKind,
                this.testArgs.xcTestArgs,
                true
            );

            if (testBuildConfig === null || this.testRun.isCancellationRequested) {
                return this.testRun.runState;
            }

            // XCTestRuns are started immediately
            this.testRun.testRunStarted();

            await this.launchTests(
                runState,
                this.testKind,
                this.testOutputWritable(TestLibrary.xctest, runState),
                testBuildConfig,
                TestLibrary.xctest
            );
        }

        return this.testRun.runState;
    }

    private async launchTests(
        runState: TestRunnerTestRunState,
        testKind: TestKind,
        outputStream: stream.Writable,
        testBuildConfig: vscode.DebugConfiguration,
        testLibrary: TestLibrary
    ) {
        try {
            switch (testKind) {
                case TestKind.coverage:
                    await this.runCoverageSession(outputStream, testBuildConfig, testLibrary);
                    break;
                case TestKind.parallel:
                    await this.runParallelSession(outputStream, testBuildConfig, runState);
                    break;
                default:
                    await this.runStandardSession(outputStream, testBuildConfig, testKind);
                    break;
            }
        } catch (error) {
            // Test failures result in error code 1
            if (error !== 1) {
                this.testRun.appendOutput(`\r\nError: ${getErrorDescription(error)}`);
            } else {
                // swift-testing tests don't have their run started until the .swift-testing binary has
                // sent all of its `test` events, which enumerate the parameterized test cases. This means that
                // build output is witheld until the run starts. If there is a compile error, unless we call
                // `testRunStarted()` to flush the buffer of test result output, the build error will be silently
                // discarded. If the test run has already started this is a no-op so its safe to call it multiple times.
                this.testRun.testRunStarted();

                this.swiftTestOutputParser.close();
            }
        } finally {
            outputStream.end();
        }
    }

    /** Run tests outside of debugger */
    async runStandardSession(
        outputStream: stream.Writable,
        testBuildConfig: vscode.DebugConfiguration,
        testKind: TestKind
    ) {
        return new Promise<void>((resolve, reject) => {
            const args = testBuildConfig.args ?? [];
            let kindLabel: string;
            switch (testKind) {
                case TestKind.coverage:
                    kindLabel = " With Code Coverage";
                    break;
                case TestKind.parallel:
                    kindLabel = " In Parallel";
                    break;
                case TestKind.debug:
                    kindLabel = " For Debugging";
                    break;
                case TestKind.release:
                    kindLabel = " in Release Mode";
                    break;
                case TestKind.debugRelease:
                    kindLabel = " For Debugging in Release Mode";
                    break;
                case TestKind.standard:
                    kindLabel = "";
            }

            const task = createSwiftTask(
                args,
                `Building and Running Tests${kindLabel}`,
                {
                    cwd: this.folderContext.folder,
                    scope: this.folderContext.workspaceFolder,
                    prefix: this.folderContext.name,
                    presentationOptions: { reveal: vscode.TaskRevealKind.Never },
                },
                this.folderContext.workspaceContext.toolchain,
                { ...process.env, ...testBuildConfig.env },
                { readOnlyTerminal: process.platform !== "win32" }
            );

            task.execution.onDidWrite(str => {
                const replaced = str
                    .replace("[1/1] Planning build", "") // Work around SPM still emitting progress when doing --no-build.
                    .replace(/\[1\/1\] Write swift-version-.*/gm, "")
                    .replace(
                        /LLVM Profile Error: Failed to write file "default.profraw": Operation not permitted\r\n/gm,
                        ""
                    ); // Work around benign LLVM coverage warnings
                outputStream.write(replaced);
            });

            // If the test run is iterrupted by a cancellation request from VS Code, ensure the task is terminated.
            const cancellationDisposable = this.testRun.token.onCancellationRequested(() => {
                task.execution.terminate("SIGINT");
            });

            task.execution.onDidClose(code => {
                cancellationDisposable.dispose();

                // undefined or 0 are viewed as success
                if (!code) {
                    resolve();
                } else {
                    reject(code);
                }
            });

            this.folderContext.taskQueue.queueOperation(
                new TaskOperation(task),
                this.testRun.token
            );
        });
    }

    /** Run tests with code coverage, and parse coverage results */
    async runCoverageSession(
        outputStream: stream.Writable,
        testBuildConfig: vscode.DebugConfiguration,
        testLibrary: TestLibrary
    ) {
        try {
            await this.runStandardSession(outputStream, testBuildConfig, TestKind.coverage);
        } catch (error) {
            // If this isn't a standard test failure, forward the error and skip generating coverage.
            if (error !== 1) {
                throw error;
            }
        }

        await this.testRun.coverage.captureCoverage(testLibrary);
    }

    /** Run tests in parallel outside of debugger */
    async runParallelSession(
        outputStream: stream.Writable,
        testBuildConfig: vscode.DebugConfiguration,
        runState: TestRunnerTestRunState
    ) {
        await this.workspaceContext.tempFolder.withTemporaryFile("xml", async filename => {
            const args = [...(testBuildConfig.args ?? []), "--xunit-output", filename];

            try {
                testBuildConfig.args = await this.runStandardSession(
                    outputStream,
                    {
                        ...testBuildConfig,
                        args,
                    },
                    TestKind.parallel
                );
            } catch (error) {
                // If this isn't a standard test failure, forward the error and skip generating coverage.
                if (error !== 1) {
                    throw error;
                }
            }

            const buffer = await asyncfs.readFile(filename, "utf8");
            const xUnitParser = new TestXUnitParser(
                this.folderContext.workspaceContext.toolchain.hasMultiLineParallelTestOutput
            );
            const results = await xUnitParser.parse(
                buffer,
                runState,
                this.workspaceContext.outputChannel
            );
            if (results) {
                this.testRun.appendOutput(
                    `\r\nExecuted ${results.tests} tests, with ${results.failures} failures and ${results.errors} errors.\r\n`
                );
            }
        });
    }

    /** Run test session inside debugger */
    async debugSession(runState: TestRunnerTestRunState) {
        // Perform a build all first to produce the binaries we'll run later.
        let buildOutput = "";
        try {
            await this.runStandardSession(
                // Capture the output to print it in case of a build error.
                // We dont want to associate it with the test run.
                new stream.Writable({
                    write: (chunk, _encoding, next) => {
                        buildOutput += chunk.toString();
                        next();
                    },
                }),
                BuildConfigurationFactory.buildAll(
                    this.folderContext,
                    true,
                    isRelease(this.testKind)
                ),
                this.testKind
            );
        } catch (buildExitCode) {
            runState.recordOutput(undefined, buildOutput);
            throw new Error(`Build failed with exit code ${buildExitCode}`);
        }

        const testRunTime = Date.now();
        const subscriptions: vscode.Disposable[] = [];
        const buildConfigs: Array<vscode.DebugConfiguration | undefined> = [];
        const fifoPipePath = this.generateFifoPipePath(testRunTime);

        await TemporaryFolder.withNamedTemporaryFiles([fifoPipePath], async () => {
            if (this.testArgs.hasSwiftTestingTests) {
                // macOS/Linux require us to create the named pipe before we use it.
                // Windows just lets us communicate by specifying a pipe path without any ceremony.
                if (process.platform !== "win32") {
                    await execFile("mkfifo", [fifoPipePath], undefined, this.folderContext);
                }
                // Create the swift-testing configuration JSON file, peparing any
                // directories the configuration may require.
                const attachmentFolder = await SwiftTestingConfigurationSetup.setupAttachmentFolder(
                    this.folderContext,
                    testRunTime
                );
                const swiftTestingArgs = await SwiftTestingBuildAguments.build(
                    fifoPipePath,
                    attachmentFolder
                );

                const swiftTestBuildConfig = await TestingConfigurationFactory.swiftTestingConfig(
                    this.folderContext,
                    swiftTestingArgs,
                    this.testKind,
                    this.testArgs.swiftTestArgs,
                    true
                );

                if (swiftTestBuildConfig !== null) {
                    swiftTestBuildConfig.testType = TestLibrary.swiftTesting;
                    swiftTestBuildConfig.preLaunchTask = null;

                    // If we're testing in both frameworks we're going to start more than one debugging
                    // session. If both build configurations have the same name LLDB will replace the
                    // output of the first one in the Debug Console with the output of the second one.
                    // If they each have a unique name the Debug Console gets a nice dropdown the user
                    // can switch between to see the output for both sessions.
                    swiftTestBuildConfig.name = `Swift Testing: ${swiftTestBuildConfig.name}`;

                    // output test build configuration
                    if (configuration.diagnostics) {
                        const configJSON = JSON.stringify(swiftTestBuildConfig);
                        this.workspaceContext.outputChannel.logDiagnostic(
                            `swift-testing Debug Config: ${configJSON}`,
                            this.folderContext.name
                        );
                    }

                    buildConfigs.push(swiftTestBuildConfig);
                }
            }

            // create launch config for testing
            if (this.testArgs.hasXCTests) {
                const xcTestBuildConfig = await TestingConfigurationFactory.xcTestConfig(
                    this.folderContext,
                    this.testKind,
                    this.testArgs.xcTestArgs,
                    true
                );

                if (xcTestBuildConfig !== null) {
                    xcTestBuildConfig.testType = TestLibrary.xctest;
                    xcTestBuildConfig.preLaunchTask = null;
                    xcTestBuildConfig.name = `XCTest: ${xcTestBuildConfig.name}`;

                    // output test build configuration
                    if (configuration.diagnostics) {
                        const configJSON = JSON.stringify(xcTestBuildConfig);
                        this.workspaceContext.outputChannel.logDiagnostic(
                            `XCTest Debug Config: ${configJSON}`,
                            this.folderContext.name
                        );
                    }

                    buildConfigs.push(xcTestBuildConfig);
                }
            }

            const validBuildConfigs = buildConfigs.filter(
                config => config !== null
            ) as vscode.DebugConfiguration[];

            const debugRuns = validBuildConfigs.map(config => {
                return () =>
                    new Promise<void>((resolve, reject) => {
                        if (this.testRun.isCancellationRequested) {
                            resolve();
                            return;
                        }

                        const startSession = vscode.debug.onDidStartDebugSession(session => {
                            if (config.testType === TestLibrary.xctest) {
                                this.testRun.testRunStarted();
                            }

                            this.workspaceContext.outputChannel.logDiagnostic(
                                "Start Test Debugging",
                                this.folderContext.name
                            );

                            const outputHandler = this.testOutputHandler(config.testType, runState);
                            LoggingDebugAdapterTracker.setDebugSessionCallback(
                                session,
                                this.workspaceContext.outputChannel,
                                output => {
                                    outputHandler(output);
                                }
                            );

                            // add cancellation
                            const cancellation = this.testRun.token.onCancellationRequested(() => {
                                this.workspaceContext.outputChannel.logDiagnostic(
                                    "Test Debugging Cancelled",
                                    this.folderContext.name
                                );
                                vscode.debug.stopDebugging(session);
                                resolve();
                            });
                            subscriptions.push(cancellation);
                        });
                        subscriptions.push(startSession);

                        vscode.debug
                            .startDebugging(this.folderContext.workspaceFolder, config)
                            .then(
                                async started => {
                                    if (started) {
                                        if (config.testType === TestLibrary.swiftTesting) {
                                            // Watch the pipe for JSONL output and parse the events into test explorer updates.
                                            // The await simply waits for the watching to be configured.
                                            await this.swiftTestOutputParser.watch(
                                                fifoPipePath,
                                                runState
                                            );
                                        }

                                        // show test results pane
                                        vscode.commands.executeCommand(
                                            "testing.showMostRecentOutput"
                                        );

                                        const terminateSession =
                                            vscode.debug.onDidTerminateDebugSession(() => {
                                                this.workspaceContext.outputChannel.logDiagnostic(
                                                    "Stop Test Debugging",
                                                    this.folderContext.name
                                                );
                                                // dispose terminate debug handler
                                                subscriptions.forEach(sub => sub.dispose());

                                                vscode.commands.executeCommand(
                                                    "workbench.view.extension.test"
                                                );

                                                resolve();
                                            });
                                        subscriptions.push(terminateSession);
                                    } else {
                                        subscriptions.forEach(sub => sub.dispose());
                                        reject("Debugger not started");
                                    }
                                },
                                reason => {
                                    subscriptions.forEach(sub => sub.dispose());
                                    reject(reason);
                                }
                            );
                    });
            });

            // Run each debugging session sequentially
            await debugRuns.reduce((p, fn) => p.then(() => fn()), Promise.resolve());

            // Clean up any leftover resources
            await SwiftTestingConfigurationSetup.cleanupAttachmentFolder(
                this.folderContext,
                testRunTime,
                this.workspaceContext.outputChannel
            );
        });
    }

    /** Returns a callback that handles a chunk of stdout output from a test run. */
    private testOutputHandler(
        testLibrary: TestLibrary,
        runState: TestRunnerTestRunState
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): (chunk: any) => void {
        let preambleComplete = false;
        switch (testLibrary) {
            case TestLibrary.swiftTesting:
                return chunk => {
                    // Capture all the output from the build process up until the test run starts.
                    // From there the SwiftTestingOutputParser reconstructs the test output from the JSON events
                    // emitted by the swift-testing binary during the run. This allows individual messages to be
                    // associated with their respective tests while still producing a complete test run log.
                    if (chunk.indexOf("Test run started.") !== -1) {
                        preambleComplete = true;
                    }
                    if (!preambleComplete) {
                        this.testRun.appendOutput(chunk.toString().replace(/\n/g, "\r\n"));
                    } else {
                        this.swiftTestOutputParser.parseStdout(chunk.toString(), runState);
                    }
                };
            case TestLibrary.xctest:
                return chunk => this.xcTestOutputParser.parseResult(chunk.toString(), runState);
        }
    }

    /** Returns a `stream.Writable` that handles a chunk of stdout output from a test run. */
    private testOutputWritable(
        testLibrary: TestLibrary,
        runState: TestRunnerTestRunState
    ): stream.Writable {
        const handler = this.testOutputHandler(testLibrary, runState);
        return new stream.Writable({
            write: (chunk, _encoding, next) => {
                handler(chunk);
                next();
            },
        });
    }

    /** Get TestItem finder for current platform */
    get testItemFinder(): TestItemFinder {
        if (process.platform === "darwin") {
            return new DarwinTestItemFinder(this.testArgs.testItems);
        } else {
            return new NonDarwinTestItemFinder(this.testArgs.testItems, this.folderContext);
        }
    }

    private generateFifoPipePath(testRunDateNow: number): string {
        return process.platform === "win32"
            ? `\\\\.\\pipe\\vscodemkfifo-${testRunDateNow}`
            : path.join(os.tmpdir(), `vscodemkfifo-${testRunDateNow}`);
    }
}

/** Interface defining how to find test items given a test id from XCTest output */
interface TestItemFinder {
    getIndex(id: string, filename?: string): number;
    testItems: vscode.TestItem[];
}

/** Defines how to find test items given a test id from XCTest output on Darwin platforms */
class DarwinTestItemFinder implements TestItemFinder {
    constructor(public testItems: vscode.TestItem[]) {}

    getIndex(id: string): number {
        return this.testItems.findIndex(item => item.id === id);
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
        const target = this.folderContext.swiftPackage.targets.find(
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

/**
 * Store state of current test run output parse
 */
export class TestRunnerTestRunState implements ITestRunState {
    constructor(private testRun: TestRunProxy) {}

    public currentTestItem?: vscode.TestItem;
    public lastTestItem?: vscode.TestItem;
    public excess?: string;
    public failedTest?: {
        testIndex: number;
        message: string;
        file: string;
        lineNumber: number;
        complete: boolean;
    };
    private startTimes: Map<number, number | undefined> = new Map();
    private issues: Map<number, { isKnown: boolean; message: vscode.TestMessage }[]> = new Map();

    getTestItemIndex(id: string, filename?: string): number {
        return this.testRun.getTestIndex(id, filename);
    }

    // set test item to be started
    started(index: number, startTime?: number) {
        if (this.isUnknownTest(index)) {
            return;
        }
        const testItem = this.testRun.testItems[index];
        this.issues.delete(index);
        this.testRun.started(testItem);
        this.currentTestItem = testItem;
        this.startTimes.set(index, startTime);
    }

    // set test item to have passed or failed, depending on if any issues were recorded
    completed(index: number, timing: { duration: number } | { timestamp: number }) {
        if (this.isUnknownTest(index)) {
            return;
        }
        const test = this.testRun.testItems[index];
        const startTime = this.startTimes.get(index);

        let duration: number;
        if ("timestamp" in timing) {
            // Completion was specified in timestamp format but the test has no saved `started` timestamp.
            // This is a bug in the code and can't be caused by a user.
            if (startTime === undefined) {
                throw Error(
                    "Timestamp was provided on test completion, but there was no startTime set when the test was started."
                );
            }
            duration = (timing.timestamp - startTime) * 1000;
        } else {
            duration = timing.duration * 1000;
        }

        const isSuite = test.children.size > 0;
        const issues = isSuite ? this.childrensIssues(test) : (this.issues.get(index) ?? []);
        if (issues.length > 0) {
            const allUnknownIssues = issues.filter(({ isKnown }) => !isKnown);
            if (allUnknownIssues.length === 0) {
                this.testRun.skipped(test);
            } else if (isSuite) {
                // Suites deliberately report no issues since the suite's children will,
                // and we don't want to duplicate issues. This would make navigating via
                // the "prev/next issue" buttons confusing.
                this.testRun.failed(test, [], duration);
            } else {
                this.testRun.failed(
                    test,
                    allUnknownIssues.map(({ message }) => message),
                    duration
                );
            }
        } else {
            this.testRun.passed(test, duration);
        }

        this.lastTestItem = this.currentTestItem;
        this.currentTestItem = undefined;
    }

    // Gather the issues of test children into a flat collection.
    private childrensIssues(test: vscode.TestItem): {
        isKnown: boolean;
        message: vscode.TestMessage;
    }[] {
        const index = this.getTestItemIndex(test.id);
        return [
            ...(this.issues.get(index) ?? []),
            ...reduceTestItemChildren(
                test.children,
                (acc, test) => [
                    ...acc,
                    ...this.childrensIssues(test).map(issue => {
                        issue.message.message = `${test.label} \u{203A} ${issue.message.message}`;
                        return {
                            ...issue,
                            message: issue.message,
                        };
                    }),
                ],
                [] as { isKnown: boolean; message: vscode.TestMessage }[]
            ),
        ];
    }

    recordIssue(
        index: number,
        message: string | vscode.MarkdownString,
        isKnown: boolean = false,
        location?: vscode.Location,
        diff?: TestIssueDiff
    ) {
        if (this.isUnknownTest(index)) {
            return;
        }

        const msg = new vscode.TestMessage(message);
        if (diff) {
            msg.expectedOutput = diff.expected;
            msg.actualOutput = diff.actual;
        }

        msg.location = location;
        const issueList = this.issues.get(index) ?? [];
        issueList.push({
            message: msg,
            isKnown,
        });
        this.issues.set(index, issueList);
    }

    // set test item to have been skipped
    skipped(index: number) {
        if (this.isUnknownTest(index)) {
            return;
        }
        this.testRun.skipped(this.testRun.testItems[index]);
        this.lastTestItem = this.currentTestItem;
        this.currentTestItem = undefined;
    }

    // For testing purposes we want to know if a run ran any tests we didn't expect.
    isUnknownTest(index: number) {
        if (index < 0 || index >= this.testRun.testItems.length) {
            this.testRun.unknownTestRan();
            return true;
        }
        return false;
    }

    // started suite
    startedSuite() {
        // Nothing to do here
    }
    // passed suite
    passedSuite(name: string) {
        // Regular runs don't provide the full suite name (Target.Suite)
        // in the output, so reference the last passing/failing test item
        // and derive the suite from that.

        // However, when running a parallel test run the XUnit XML output
        // provides the full suite name, and the `lastTestItem` set is not
        // guarenteed to be in this suite due to the parallel nature of the run.

        // If we can look the suite up by name then we're doing a parallel run
        // and can mark it as passed, otherwise derive the suite from the last
        // completed test item.
        const suiteIndex = this.testRun.getTestIndex(name);
        if (suiteIndex !== -1) {
            this.testRun.passed(this.testRun.testItems[suiteIndex]);
        } else {
            const lastClassTestItem = this.lastTestItem?.parent;
            if (lastClassTestItem && lastClassTestItem.id.endsWith(`.${name}`)) {
                this.testRun.passed(lastClassTestItem);
            }
        }
    }
    // failed suite
    failedSuite(name: string) {
        // See comment in `passedSuite` for more context.
        const suiteIndex = this.testRun.getTestIndex(name);
        if (suiteIndex !== -1) {
            this.testRun.failed(this.testRun.testItems[suiteIndex], []);
        } else {
            const lastClassTestItem = this.lastTestItem?.parent;
            if (lastClassTestItem && lastClassTestItem.id.endsWith(`.${name}`)) {
                this.testRun.failed(lastClassTestItem, []);
            }
        }
    }

    recordOutput(index: number | undefined, output: string): void {
        if (index === undefined || this.isUnknownTest(index)) {
            this.testRun.appendOutput(output);
            return;
        }

        const testItem = this.testRun.testItems[index];
        const { uri, range } = testItem;
        const location = uri && range ? new vscode.Location(uri, range) : undefined;
        this.testRun.appendOutputToTest(output, testItem, location);
    }
}
