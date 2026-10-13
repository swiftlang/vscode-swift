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
import * as asyncfs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as stream from "stream";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { TargetType } from "../SwiftPackage";
import { WorkspaceContext } from "../WorkspaceContext";
import configuration from "../configuration";
import {
    BuildConfigurationFactory,
    SwiftTestingBuildAguments,
    SwiftTestingConfigurationSetup,
    TestingConfigurationFactory,
    effectiveBuildSystem,
    groupTestsByTarget,
} from "../debugger/buildConfig";
import { LoggingDebugAdapterTracker } from "../debugger/logTracker";
import { createSwiftTask } from "../tasks/SwiftTaskProvider";
import { TaskOperation } from "../tasks/TaskQueue";
import { Disposable } from "../utilities/Disposable";
import {
    CompositeCancellationToken,
    CompositeCancellationTokenSource,
} from "../utilities/cancellation";
import { packageName, resolveScope } from "../utilities/tasks";
import { TemporaryFolder } from "../utilities/tempFolder";
import { IS_RUNNING_UNDER_TEST, execFile, getErrorDescription } from "../utilities/utilities";
import { runnableTag } from "./TestDiscovery";
import { TestKind, isDebugging, isRelease } from "./TestKind";
import { SwiftTestingOutputParser } from "./TestParsers/SwiftTestingOutputParser";
import { ITestRunState, TestIssueDiff, durationFrom } from "./TestParsers/TestRunState";
import {
    IXCTestOutputParser,
    ParallelXCTestOutputParser,
    XCTestOutputParser,
} from "./TestParsers/XCTestOutputParser";
import { TestRunArguments } from "./TestRunArguments";
import { TestRunProxy, TestRunState } from "./TestRunProxy";
import { reduceTestItemChildren } from "./TestUtils";
import { TestXUnitParser } from "./TestXUnitParser";

import stripAnsi = require("strip-ansi");

/**
 * The different types of test library supported by the test runner.
 */
export enum TestLibrary {
    xctest = "XCTest",
    swiftTesting = "swift-testing",
}

/** Printed to stdout by swift-testing when the build ends and the run begins. */
export const TEST_RUN_STARTED_MARKER = "Test run started.";

/** Reports whether swift-testing has finished building and started running tests. */
export class SwiftTestingPreamble {
    private strippedTail = "";
    private runStarted = false;

    /** Once the run has started, every subsequent call reports `true`. */
    public hasRunStarted(chunk: string): boolean {
        if (this.runStarted) {
            return true;
        }
        // Colour codes can interrupt the marker, and it can straddle two chunks — ex.
        // `...Test run st` then `arted.`. Match a stripped window carrying the previous
        // chunk's tail, since failing to match leaves the run stuck in the preamble.
        const window = stripAnsi(this.strippedTail + chunk);
        this.runStarted = window.includes(TEST_RUN_STARTED_MARKER);
        this.strippedTail = window.slice(-TEST_RUN_STARTED_MARKER.length);
        return this.runStarted;
    }
}

export function debugSessionMatchesConfig(
    config: vscode.DebugConfiguration,
    startedSessionId: string | undefined,
    session: Pick<vscode.DebugSession, "id" | "name">
): boolean {
    if (startedSessionId !== undefined && session.id === startedSessionId) {
        return true;
    }
    return session.name === config.name;
}

/** Class used to run tests */
export class TestRunner {
    public testRun: TestRunProxy;
    private testArgs: TestRunArguments;
    private xcTestOutputParser: IXCTestOutputParser;
    private swiftTestOutputParser: SwiftTestingOutputParser;
    private debugSessionTerminatedEmitter = new vscode.EventEmitter<void>();
    public onDebugSessionTerminated: vscode.Event<void>;
    private static CANCELLATION_ERROR = "Test run cancelled.";

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
        this.testRun = new TestRunProxy(
            request,
            controller,
            this.testArgs,
            folderContext,
            configuration.recordTestDuration,
            token
        );
        this.xcTestOutputParser =
            testKind === TestKind.parallel
                ? new ParallelXCTestOutputParser(
                      this.folderContext.toolchain.hasMultiLineParallelTestOutput
                  )
                : new XCTestOutputParser();
        this.swiftTestOutputParser = this.createSwiftTestOutputParser();
        this.onDebugSessionTerminated = this.debugSessionTerminatedEmitter.event;
        this.trace(
            `Created ${testKind} test runner: ${this.testArgs.testItems.length} items, XCTest=${this.testArgs.hasXCTests} (${this.testArgs.xcTestArgs.length} args), swift-testing=${this.testArgs.hasSwiftTestingTests} (${this.testArgs.swiftTestArgs.length} args)`
        );
    }

    private trace(message: string) {
        this.workspaceContext.logger.trace(`[test run ${this.testRun.runId}] ${message}`, {
            label: this.folderContext.name,
        });
    }

    private debug(message: string) {
        this.workspaceContext.logger.debug(`[test run ${this.testRun.runId}] ${message}`, {
            label: this.folderContext.name,
        });
    }

    /**
     * When performing a "Run test multiple times" run set the iteration
     * so it can be shown in the logs.
     * @param iteration The iteration counter
     */
    public setIteration(iteration: number) {
        this.trace(`Setting iteration ${iteration + 1}, resetting swift-testing parser`);
        // The SwiftTestingOutputParser holds state and needs to be reset between iterations.
        this.swiftTestOutputParser = this.createSwiftTestOutputParser();
        this.testRun.setIteration(iteration);
    }

    private createSwiftTestOutputParser(): SwiftTestingOutputParser {
        return new SwiftTestingOutputParser(
            this.testRun,
            (testIndex, path) => this.testRun.addAttachment(testIndex, path),
            this.folderContext.workspaceContext.logger
        );
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

    private get workspaceContext(): WorkspaceContext {
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
                    await this.handleTestRunRequest(
                        TestKind.standard,
                        request,
                        folderContext,
                        controller,
                        token,
                        onCreateTestRun
                    );
                },
                true,
                runnableTag
            ),
            controller.createRunProfile(
                TestKind.parallel,
                vscode.TestRunProfileKind.Run,
                async (request, token) => {
                    await this.handleTestRunRequest(
                        TestKind.parallel,
                        request,
                        folderContext,
                        controller,
                        token,
                        onCreateTestRun
                    );
                },
                false,
                runnableTag
            ),
            controller.createRunProfile(
                TestKind.release,
                vscode.TestRunProfileKind.Run,
                async (request, token) => {
                    await this.handleTestRunRequest(
                        TestKind.release,
                        request,
                        folderContext,
                        controller,
                        token,
                        onCreateTestRun
                    );
                },
                false,
                runnableTag
            ),
            // Add coverage profile
            controller.createRunProfile(
                TestKind.coverage,
                vscode.TestRunProfileKind.Coverage,
                async (request, token) => {
                    await this.handleTestRunRequest(
                        TestKind.coverage,
                        request,
                        folderContext,
                        controller,
                        token,
                        onCreateTestRun,
                        async runner => {
                            if (request.profile) {
                                request.profile.loadDetailedCoverage = async (
                                    _testRun,
                                    fileCoverage
                                ) => {
                                    return runner.testRun.loadDetailedCoverage(fileCoverage.uri);
                                };
                            }
                            await vscode.commands.executeCommand("testing.openCoverage");
                        }
                    );
                },
                false,
                runnableTag
            ),
            // Add debug profile
            controller.createRunProfile(
                TestKind.debug,
                vscode.TestRunProfileKind.Debug,
                async (request, token) => {
                    await this.handleTestRunRequest(
                        TestKind.debug,
                        request,
                        folderContext,
                        controller,
                        token,
                        onCreateTestRun
                    );
                },
                false,
                runnableTag
            ),
            controller.createRunProfile(
                TestKind.debugRelease,
                vscode.TestRunProfileKind.Debug,
                async (request, token) => {
                    await this.handleTestRunRequest(
                        TestKind.debugRelease,
                        request,
                        folderContext,
                        controller,
                        token,
                        onCreateTestRun
                    );
                },
                false,
                runnableTag
            ),
        ];
    }

    /**
     * Handle a test run request, checking if a test run is already in progress
     * @param testKind The kind of test run
     * @param request The test run request
     * @param folderContext The folder context
     * @param controller The test controller
     * @param token The cancellation token
     * @param onCreateTestRun Event emitter for test run creation
     * @param postRunHandler Optional handler to run after the test run completes
     */
    private static async handleTestRunRequest(
        testKind: TestKind,
        request: vscode.TestRunRequest,
        folderContext: FolderContext,
        controller: vscode.TestController,
        token: vscode.CancellationToken,
        onCreateTestRun: vscode.EventEmitter<TestRunProxy>,
        postRunHandler?: (runner: TestRunner) => Promise<void>
    ): Promise<void> {
        const logger = folderContext.workspaceContext.logger;
        const label = folderContext.name;
        logger.debug(
            `Test run requested: profile=${testKind}, include=${request.include?.length ?? "all"}, exclude=${request.exclude?.length ?? 0}, cancelled=${token.isCancellationRequested}`,
            { label }
        );
        // If there's an active test run, prompt the user to cancel
        if (folderContext.hasActiveTestRun()) {
            logger.trace("Test run already active, asking to replace it", { label });
            const cancelOption = "Replace Running Test";
            const result = IS_RUNNING_UNDER_TEST
                ? cancelOption
                : await vscode.window.showInformationMessage(
                      "A test run is already in progress. Would you like to cancel and replace the active test run?",
                      { modal: true },
                      cancelOption
                  );

            if (result === cancelOption && !token.isCancellationRequested) {
                // Cancel the active test run
                logger.debug("Replacing active test run", { label });
                folderContext.cancelTestRun();
            } else {
                logger.debug(
                    `Not replacing active test run (choice=${result ?? "none"}, cancelled=${token.isCancellationRequested}), dropping request`,
                    { label }
                );
                return;
            }
        }

        const compositeToken = new CompositeCancellationToken(token);

        // Create a cancellation token source for this test run
        const compositeTokenSource = new CompositeCancellationTokenSource(token);

        // Create and run the test runner
        const runner = new TestRunner(
            testKind,
            request,
            folderContext,
            controller,
            compositeTokenSource.token
        );

        // If the user terminates a debugging session for swift-testing
        // we want to prevent XCTest from starting.
        const terminationListener = runner.onDebugSessionTerminated(() => {
            runner.debug("Debug session terminated by user, cancelling remaining test run");
            compositeTokenSource.cancel();
        });

        // If the user cancels the test run via the VS Code UI, skip the pending tests
        // so they don't appear as failed. Any pending tests left over at the end of a run
        // are assumed to have crashed.
        const cancellationListener = compositeToken.onCancellationRequested(() => {
            runner.debug("Test run request cancelled, skipping pending tests");
            runner.testRun.skipPendingTests();
        });

        // Register the test run with the manager
        folderContext.registerTestRun(runner.testRun, compositeTokenSource);

        // Fire the event to notify that a test run was created
        onCreateTestRun.fire(runner.testRun);

        // Run the tests
        runner.trace("Awaiting run handler");
        await runner.runHandler();
        runner.trace("Run handler returned");

        terminationListener.dispose();
        cancellationListener.dispose();

        // Run the post-run handler if provided
        if (postRunHandler) {
            runner.trace("Running post-run handler");
            await postRunHandler(runner);
            runner.trace("Post-run handler finished");
        }
    }

    /**
     * Extracts a list of unique test Targets from the list of test items.
     */
    private testTargets(items: vscode.TestItem[]): string[] {
        const targets = new Set<string>();
        for (const item of items) {
            const target = item.id.split(".")[0];
            targets.add(target);
        }
        return Array.from(targets);
    }

    /**
     * Test run handler. Run a series of tests and extracts the results from the output
     * @param shouldDebug Should we run the debugger
     * @param token Cancellation token
     * @returns When complete
     */
    async runHandler() {
        if (this.testRun.isCancellationRequested) {
            this.debug("Test run cancelled before it began, not running");
            return;
        }

        const testTargets = this.testTargets(this.testArgs.testItems);
        this.workspaceContext.testsStarted(this.folderContext, this.testKind, testTargets);

        const runState = new TestRunnerTestRunState(this.testRun);

        const cancellationDisposable = this.testRun.onCancellationRequested(() => {
            this.trace("Cancellation requested during run handler");
            this.testRun.appendOutput("\r\nTest run cancelled.");
        });

        this.trace(
            `Run handler starting ${isDebugging(this.testKind) ? "debug" : "run"} session for targets: ${testTargets.join(", ")}`
        );
        try {
            if (isDebugging(this.testKind)) {
                await this.debugSession(runState);
            } else {
                await this.runSession(runState);
            }
            this.trace(`Session completed, cancelled=${this.testRun.isCancellationRequested}`);
        } catch (error) {
            this.trace(`Session threw: ${getErrorDescription(error)}`);
            this.workspaceContext.logger.error(`Error: ${getErrorDescription(error)}`);
            this.testRun.appendOutput(`\r\nError: ${getErrorDescription(error)}`);
        }

        // Coverage must be computed before the testRun is ended as of VS Code 1.90.0
        if (this.testKind === TestKind.coverage) {
            await this.testRun.computeCoverage();
        }

        cancellationDisposable.dispose();
        await this.testRun.end();

        this.workspaceContext.testsFinished(this.folderContext, this.testKind, testTargets);
        this.trace("Run handler finished");
    }

    /** Run test session without attaching to a debugger */
    async runSession(runState: TestRunnerTestRunState): Promise<TestRunState> {
        // Run swift-testing first, then XCTest.
        // swift-testing being parallel by default should help these run faster.
        if (this.testArgs.hasSwiftTestingTests) {
            const testRunTime = Date.now();
            const fifoPipePath = this.generateFifoPipePath(testRunTime);
            this.trace(`Starting swift-testing run session, pipe=${fifoPipePath}`);

            await TemporaryFolder.withNamedTemporaryFiles([fifoPipePath], async () => {
                // macOS/Linux require us to create the named pipe before we use it.
                // Windows just lets us communicate by specifying a pipe path without any ceremony.
                if (process.platform !== "win32") {
                    this.trace("Creating swift-testing FIFO");
                    await execFile("mkfifo", [fifoPipePath], undefined, this.folderContext);
                    this.trace("Created swift-testing FIFO");
                }
                // Create the swift-testing configuration JSON file, peparing any
                // directories the configuration may require.
                const attachmentFolder = await SwiftTestingConfigurationSetup.setupAttachmentFolder(
                    this.folderContext,
                    testRunTime
                );
                const swiftTestingArgs = SwiftTestingBuildAguments.build(
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
                    this.debug(
                        `Skipping swift-testing run: config=${testBuildConfig === null ? "null" : "ok"}, cancelled=${this.testRun.isCancellationRequested}`
                    );
                    return this.testRun.runState;
                }

                const outputStream = this.testOutputWritable(TestLibrary.swiftTesting, runState);

                // Watch the pipe for JSONL output and parse the events into test explorer updates.
                // The await simply waits for the watching to be configured.
                this.trace("Setting up swift-testing pipe watch");
                await this.swiftTestOutputParser.watch(fifoPipePath, runState);
                this.trace("swift-testing pipe watch set up");

                this.testRun.testRunStarted();

                try {
                    await this.launchTests(
                        runState,
                        this.testKind === TestKind.parallel ? TestKind.standard : this.testKind,
                        outputStream,
                        testBuildConfig,
                        TestLibrary.swiftTesting
                    );
                } finally {
                    // The reader holds the FIFO open (O_RDWR on Unix, a listening
                    // server on Windows) so that sequential writers from each test
                    // target can all reach the parser. Now that `swift test` has
                    // exited we must stop the reader to release the fd before the
                    // FIFO is unlinked below.
                    this.trace("Closing swift-testing pipe reader");
                    await this.swiftTestOutputParser.close();
                    this.trace("Closed swift-testing pipe reader");
                }

                await SwiftTestingConfigurationSetup.cleanupAttachmentFolder(
                    this.folderContext,
                    testRunTime,
                    this.workspaceContext.logger
                );
            });
        }

        if (this.testArgs.hasXCTests) {
            this.trace("Starting XCTest run session");
            const testBuildConfig = await TestingConfigurationFactory.xcTestConfig(
                this.folderContext,
                this.testKind,
                this.testArgs.xcTestArgs,
                true
            );

            if (testBuildConfig === null || this.testRun.isCancellationRequested) {
                this.debug(
                    `Skipping XCTest run: config=${testBuildConfig === null ? "null" : "ok"}, cancelled=${this.testRun.isCancellationRequested}`
                );
                return this.testRun.runState;
            }

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
        this.trace(`Launching ${testLibrary} tests as ${testKind}`);
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
            this.trace(`${testLibrary} tests finished successfully`);
        } catch (error) {
            this.trace(`${testLibrary} tests finished with error: ${getErrorDescription(error)}`);
            if (error === TestRunner.CANCELLATION_ERROR) {
                this.testRun.appendOutput(`\r\n${error}`);
            } else if (error !== 1) {
                // Test failures result in error code 1
                this.testRun.appendOutput(`\r\nError: ${getErrorDescription(error)}`);
            } else {
                // swift-testing tests don't have their run started until the .swift-testing binary has
                // sent all of its `test` events, which enumerate the parameterized test cases. This means that
                // build output is witheld until the run starts. If there is a compile error, unless we call
                // `testRunStarted()` to flush the buffer of test result output, the build error will be silently
                // discarded. If the test run has already started this is a no-op so its safe to call it multiple times.
                this.testRun.testRunStarted();
            }

            // If there is a compilation error the tests slated to be run are marked as 'skipped' and not 'failed'.
            // If the user has the setting `testing.automaticallyOpenTestResults` set to `openOnTestFailure`,
            // we should still open the test results view to show the user the compilation errors.
            this.openTestResultsPanel();
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
                    scope: resolveScope(this.folderContext.workspaceFolder),
                    packageName: packageName(this.folderContext),
                    presentationOptions: { reveal: vscode.TaskRevealKind.Never },
                    logger: this.folderContext.workspaceContext.logger,
                },
                this.folderContext.toolchain,
                { ...process.env, ...testBuildConfig.env },
                { readOnlyTerminal: process.platform !== "win32" }
            );

            task.execution.onDidWrite(str => {
                const replaced = str
                    .replace(/\[1\s*\/\s*1\] Planning build/g, "") // Work around SPM still emitting progress when doing --no-build.
                    .replace(/\[1\s*\/\s*1\] Write swift-version-.*/gm, "")
                    .replace(
                        /LLVM Profile Error: Failed to write file "default.profraw": Operation not permitted\r\n/gm,
                        ""
                    ); // Work around benign LLVM coverage warnings
                outputStream.write(replaced);
            });

            // If the test run is iterrupted by a cancellation request from VS Code, ensure the task is terminated.
            const cancellationDisposable = this.testRun.onCancellationRequested(() => {
                this.trace(`Cancellation requested, sending SIGINT to "${task.name}"`);
                task.execution.terminate("SIGINT");
                reject(TestRunner.CANCELLATION_ERROR);
            });

            task.execution.onDidClose(code => {
                this.trace(`Task "${task.name}" closed with exit code ${code}`);
                cancellationDisposable.dispose();

                // undefined or 0 are viewed as success
                if (!code) {
                    resolve();
                } else {
                    reject(code);
                }
            });

            this.trace(
                `Queueing task "${task.name}" (${testKind}), cancelled=${this.testRun.isCancellationRequested}`
            );
            void this.folderContext.taskQueue.queueOperation(new TaskOperation(task), this.testRun);
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

        this.trace(`Capturing ${testLibrary} coverage`);
        await this.testRun.captureCoverage(testLibrary);
        this.trace(`Captured ${testLibrary} coverage`);
    }

    /** Run tests in parallel outside of debugger */
    async runParallelSession(
        outputStream: stream.Writable,
        testBuildConfig: vscode.DebugConfiguration,
        runState: TestRunnerTestRunState
    ) {
        const tempFolder = await TemporaryFolder.create();
        await tempFolder.withTemporaryFile("xml", async filename => {
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

            this.trace(`Reading xUnit output from ${filename}`);
            const buffer = await asyncfs.readFile(filename, "utf8");
            this.trace(`Read ${buffer.length} chars of xUnit output`);
            const xUnitParser = new TestXUnitParser(
                this.folderContext.toolchain.hasMultiLineParallelTestOutput
            );
            const results = await xUnitParser.parse(buffer, runState, this.workspaceContext.logger);
            this.trace(
                results
                    ? `Parsed xUnit output: ${results.tests} tests, ${results.failures} failures, ${results.errors} errors`
                    : "Failed to parse xUnit output"
            );
            if (results) {
                this.testRun.appendOutput(
                    `\r\nExecuted ${results.tests} tests, with ${results.failures} failures and ${results.errors} errors.\r\n`
                );
            }
        });
    }

    /** Run test session inside debugger */
    async debugSession(
        runState: TestRunnerTestRunState,
        performBuild: boolean = true
    ): Promise<TestRunState> {
        if (performBuild) {
            // Perform a build all first to produce the binaries we'll run later.
            let buildOutput = "";
            this.trace("Building tests before debugging");
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
                    await BuildConfigurationFactory.buildAll(
                        this.folderContext,
                        true,
                        isRelease(this.testKind)
                    ),
                    this.testKind
                );
                this.debug("Build before debugging succeeded");
            } catch (buildExitCode) {
                this.debug(`Build before debugging failed: ${getErrorDescription(buildExitCode)}`);
                runState.recordOutput(undefined, buildOutput);
                // Check if we should open test results panel on compiler error
                this.openTestResultsPanel();
                // eslint-disable-next-line preserve-caught-error
                throw new Error(`Build failed with exit code ${buildExitCode}`);
            }
        }

        const testRunTime = Date.now();
        const subscriptions: Disposable[] = [];
        const buildConfigs: Array<vscode.DebugConfiguration | undefined> = [];
        const fifoPipePath = this.generateFifoPipePath(testRunTime);

        await TemporaryFolder.withNamedTemporaryFiles([fifoPipePath], async () => {
            const allBuildArgs = [
                ...configuration.buildArguments,
                ...configuration.folder(this.folderContext.workspaceFolder).additionalTestArguments,
            ];
            const buildSystem = effectiveBuildSystem(this.folderContext.swiftVersion, allBuildArgs);
            this.trace(`Creating debug configurations, build system=${buildSystem}`);

            if (this.testArgs.hasSwiftTestingTests) {
                // macOS/Linux require us to create the named pipe before we use it.
                // Windows just lets us communicate by specifying a pipe path without any ceremony.
                if (process.platform !== "win32") {
                    this.trace(`Creating swift-testing FIFO ${fifoPipePath}`);
                    await execFile("mkfifo", [fifoPipePath], undefined, this.folderContext);
                    this.trace("Created swift-testing FIFO");
                }
                // Create the swift-testing configuration JSON file, preparing any
                // directories the configuration may require.
                const attachmentFolder = await SwiftTestingConfigurationSetup.setupAttachmentFolder(
                    this.folderContext,
                    testRunTime
                );
                const swiftTestingArgs = SwiftTestingBuildAguments.build(
                    fifoPipePath,
                    attachmentFolder
                );

                const configs =
                    buildSystem === "swiftbuild"
                        ? await this.swiftbuildSwiftTestingConfigs(swiftTestingArgs)
                        : await this.nativeSwiftTestingConfigs(swiftTestingArgs);
                buildConfigs.push(...configs);
            }

            // create launch config for testing
            if (this.testArgs.hasXCTests) {
                const configs =
                    buildSystem === "swiftbuild"
                        ? await this.swiftbuildXCTestConfigs()
                        : await this.nativeXCTestConfigs();
                buildConfigs.push(...configs);
            }

            const validBuildConfigs = buildConfigs.filter(
                config => !!config
            ) as vscode.DebugConfiguration[];

            const debugRuns = validBuildConfigs.map(config => {
                return () => this.startDebugSession(config, runState, subscriptions, fifoPipePath);
            });

            // Run each debugging session sequentially
            this.debug(
                `Running ${debugRuns.length} debug sessions sequentially (${buildConfigs.length - debugRuns.length} configs skipped)`
            );
            await debugRuns.reduce((p, fn) => p.then(() => fn()), Promise.resolve());
            this.trace("All debug sessions finished");

            // Clean up any leftover resources
            await SwiftTestingConfigurationSetup.cleanupAttachmentFolder(
                this.folderContext,
                testRunTime,
                this.workspaceContext.logger
            );
        });

        return this.testRun.runState;
    }

    // Creates one swift-testing debug configuration per test target for the swiftbuild build system.
    private async swiftbuildSwiftTestingConfigs(
        swiftTestingArgs: SwiftTestingBuildAguments
    ): Promise<vscode.DebugConfiguration[]> {
        const targets = await this.targetNamesForBuildSystem(this.testArgs.swiftTestArgs);
        const pkgName = await this.folderContext.swiftPackage.name;
        const configs: vscode.DebugConfiguration[] = [];

        for (const [targetName, testSubset] of targets) {
            const config = await TestingConfigurationFactory.swiftTestingConfig(
                this.folderContext,
                swiftTestingArgs,
                this.testKind,
                testSubset,
                true,
                targetName
            );

            if (config !== null) {
                config.testType = TestLibrary.swiftTesting;
                config.preLaunchTask = null;
                config.name = `Swift Testing (${targetName}): Test ${pkgName}`;

                const configJSON = JSON.stringify(config);
                this.workspaceContext.logger.debug(`swift-testing Debug Config: ${configJSON}`, {
                    label: this.folderContext.name,
                });

                configs.push(config);
            }
        }

        return configs;
    }

    // Creates one XCTest debug configuration per test target for the swiftbuild build system.
    private async swiftbuildXCTestConfigs(): Promise<vscode.DebugConfiguration[]> {
        const targets = await this.targetNamesForBuildSystem(this.testArgs.xcTestArgs);
        const pkgName = await this.folderContext.swiftPackage.name;
        const configs: vscode.DebugConfiguration[] = [];

        for (const [targetName, testSubset] of targets) {
            const config = await TestingConfigurationFactory.xcTestConfig(
                this.folderContext,
                this.testKind,
                testSubset,
                true,
                targetName
            );

            if (config !== null) {
                config.testType = TestLibrary.xctest;
                config.preLaunchTask = null;
                config.name = `XCTest (${targetName}): Test ${pkgName}`;

                const configJSON = JSON.stringify(config);
                this.workspaceContext.logger.debug(`XCTest Debug Config: ${configJSON}`, {
                    label: this.folderContext.name,
                });

                configs.push(config);
            }
        }

        return configs;
    }

    // Creates a single swift-testing debug configuration for the native build system.
    private async nativeSwiftTestingConfigs(
        swiftTestingArgs: SwiftTestingBuildAguments
    ): Promise<vscode.DebugConfiguration[]> {
        const swiftTestBuildConfig = await TestingConfigurationFactory.swiftTestingConfig(
            this.folderContext,
            swiftTestingArgs,
            this.testKind,
            this.testArgs.swiftTestArgs,
            true
        );

        if (swiftTestBuildConfig === null) {
            return [];
        }

        swiftTestBuildConfig.testType = TestLibrary.swiftTesting;
        swiftTestBuildConfig.preLaunchTask = null;

        // If we're testing in both frameworks we're going to start more than one debugging
        // session. If both build configurations have the same name LLDB will replace the
        // output of the first one in the Debug Console with the output of the second one.
        // If they each have a unique name the Debug Console gets a nice dropdown the user
        // can switch between to see the output for both sessions.
        swiftTestBuildConfig.name = `Swift Testing: ${swiftTestBuildConfig.name}`;

        // output test build configuration
        const configJSON = JSON.stringify(swiftTestBuildConfig);
        this.workspaceContext.logger.debug(`swift-testing Debug Config: ${configJSON}`, {
            label: this.folderContext.name,
        });

        return [swiftTestBuildConfig];
    }

    // Creates a single XCTest debug configuration for the native build system.
    private async nativeXCTestConfigs(): Promise<vscode.DebugConfiguration[]> {
        const xcTestBuildConfig = await TestingConfigurationFactory.xcTestConfig(
            this.folderContext,
            this.testKind,
            this.testArgs.xcTestArgs,
            true
        );

        if (xcTestBuildConfig === null) {
            return [];
        }

        xcTestBuildConfig.testType = TestLibrary.xctest;
        xcTestBuildConfig.preLaunchTask = null;
        xcTestBuildConfig.name = `XCTest: ${xcTestBuildConfig.name}`;

        // output test build configuration
        const configJSON = JSON.stringify(xcTestBuildConfig);
        this.workspaceContext.logger.debug(`XCTest Debug Config: ${configJSON}`, {
            label: this.folderContext.name,
        });

        return [xcTestBuildConfig];
    }

    // Groups test args by target, or enumerates all test targets for the "run all" case.
    private async targetNamesForBuildSystem(
        testArgs: readonly string[]
    ): Promise<ReadonlyMap<string, string[]>> {
        const testTargets = await this.folderContext.swiftPackage.getTargets(TargetType.test);
        if (testArgs.length === 0) {
            return new Map(testTargets.map(t => [t.name, []]));
        }
        const c99ToName = new Map(testTargets.map(t => [t.c99name, t.name]));
        return groupTestsByTarget(testArgs, c99ToName) as Map<string, string[]>;
    }

    private startDebugSession(
        config: vscode.DebugConfiguration,
        runState: TestRunnerTestRunState,
        subscriptions: Disposable[],
        fifoPipePath: string
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.testRun.isCancellationRequested) {
                this.debug(`Not starting debug session "${config.name}", test run cancelled`);
                resolve();
                return;
            }

            let startedSessionId: string | undefined;

            let settled = false;
            const finish = (reason: string) => {
                if (settled) {
                    this.trace(
                        `Debug session "${config.name}" already finished, ignoring ${reason}`
                    );
                    return;
                }
                this.debug(`Debug session "${config.name}" finished: ${reason}`);
                settled = true;
                subscriptions.forEach(sub => sub.dispose());
                if (config.testType === TestLibrary.swiftTesting) {
                    void this.swiftTestOutputParser.close();
                }
                void vscode.commands.executeCommand("workbench.view.extension.test").then(() => {
                    this.trace(`Debug session "${config.name}" resolved`);
                    resolve();
                });
            };

            const startSession = vscode.debug.onDidStartDebugSession(session => {
                this.trace(
                    `Debug session started: id=${session.id}, name="${session.name}", expecting "${config.name}"`
                );
                startedSessionId = session.id;
                const outputHandler = this.testOutputHandler(config.testType, runState);
                outputHandler(`> ${config.program} ${config.args.join(" ")}\n\n\r`);

                LoggingDebugAdapterTracker.setDebugSessionCallback(
                    session,
                    this.workspaceContext.logger,
                    output => outputHandler(output),
                    exitCode => {
                        this.trace(
                            `Debug session ${session.id} process exited with code ${exitCode}`
                        );
                        if (exitCode === 9) {
                            this.debugSessionTerminatedEmitter.fire();
                        }
                        finish(`process exited with code ${exitCode}`);
                    }
                );

                const cancellation = this.testRun.onCancellationRequested(() => {
                    void vscode.debug.stopDebugging(session).then(
                        () => finish("stopped after cancellation"),
                        () => finish("failed to stop after cancellation")
                    );
                });
                subscriptions.push(cancellation);
            });
            subscriptions.push(startSession);

            const terminateSession = vscode.debug.onDidTerminateDebugSession(e => {
                if (!debugSessionMatchesConfig(config, startedSessionId, e)) {
                    this.trace(
                        `Ignoring termination of unrelated debug session id=${e.id}, name="${e.name}"`
                    );
                    return;
                }
                finish(`session ${e.id} terminated`);
            });
            subscriptions.push(terminateSession);

            this.debug(`Starting debug session "${config.name}" (${config.testType})`);
            vscode.debug.startDebugging(this.folderContext.workspaceFolder, config).then(
                async started => {
                    this.trace(`startDebugging for "${config.name}" returned ${started}`);
                    if (started) {
                        if (config.testType === TestLibrary.swiftTesting) {
                            this.trace("Setting up swift-testing pipe watch for debug session");
                            await this.swiftTestOutputParser.watch(fifoPipePath, runState);
                            this.trace(
                                `swift-testing pipe watch set up, session settled=${settled}`
                            );
                        }
                        this.testRun.testRunStarted();
                    } else {
                        settled = true;
                        subscriptions.forEach(sub => sub.dispose());
                        reject("Debugger not started");
                    }
                },
                reason => {
                    this.trace(
                        `startDebugging for "${config.name}" failed: ${getErrorDescription(reason)}`
                    );
                    settled = true;
                    subscriptions.forEach(sub => sub.dispose());
                    reject(reason);
                }
            );
        });
    }

    /** Returns a callback that handles a chunk of stdout output from a test run. */
    private testOutputHandler(
        testLibrary: TestLibrary,
        runState: TestRunnerTestRunState
    ): (chunk: string | Buffer) => void {
        switch (testLibrary) {
            case TestLibrary.swiftTesting: {
                const preamble = new SwiftTestingPreamble();
                let sawRunStart = false;
                return chunk => {
                    // Capture all the output from the build process up until the test run starts.
                    // From there the SwiftTestingOutputParser reconstructs the test output from the JSON events
                    // emitted by the swift-testing binary during the run. This allows individual messages to be
                    // associated with their respective tests while still producing a complete test run log.
                    const output = chunk.toString();
                    if (preamble.hasRunStarted(output)) {
                        if (!sawRunStart) {
                            sawRunStart = true;
                            this.trace("swift-testing stdout reported test run started");
                        }
                        this.swiftTestOutputParser.parseStdout(output, runState);
                    } else {
                        this.testRun.appendOutput(output.replace(/\n/g, "\r\n"));
                    }
                };
            }
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

    private generateFifoPipePath(testRunDateNow: number): string {
        return process.platform === "win32"
            ? `\\\\.\\pipe\\vscodemkfifo-${testRunDateNow}`
            : path.join(os.tmpdir(), `vscodemkfifo-${testRunDateNow}`);
    }

    /**
     * Opens the test results panel if the "testing.automaticallyOpenTestResults" setting is set to "openOnTestFailure".
     */
    private openTestResultsPanel(): void {
        const testingSetting = vscode.workspace
            .getConfiguration("testing")
            .get<string>("automaticallyOpenTestResults");

        if (testingSetting === "openOnTestFailure") {
            void vscode.commands.executeCommand("workbench.panel.testResults.view.focus");
        }
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
        const duration = durationFrom(timing, this.startTimes.get(index));

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

    recordWarning(index: number, message: string, location?: vscode.Location) {
        if (this.isUnknownTest(index)) {
            return;
        }
        const test = this.testRun.testItems[index];
        this.testRun.recordWarning(test, message, location);
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
