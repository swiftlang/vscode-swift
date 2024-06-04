//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
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
import { execFile, getErrorDescription } from "../utilities/utilities";
import { createSwiftTask } from "../tasks/SwiftTaskProvider";
import configuration from "../configuration";
import { WorkspaceContext } from "../WorkspaceContext";
import {
    IXCTestOutputParser,
    ParallelXCTestOutputParser,
    XCTestOutputParser,
} from "./TestParsers/XCTestOutputParser";
import { SwiftTestingOutputParser } from "./TestParsers/SwiftTestingOutputParser";
import { LoggingDebugAdapterTracker } from "../debugger/logTracker";
import { TaskOperation } from "../tasks/TaskQueue";
import { TestXUnitParser } from "./TestXUnitParser";
import { ITestRunState } from "./TestParsers/TestRunState";
import { TestRunArguments } from "./TestRunArguments";
import { TemporaryFolder } from "../utilities/tempFolder";
import { TestClass, runnableTag, upsertTestItem } from "./TestDiscovery";
import { TestCoverage } from "../coverage/LcovResults";
import { TestingDebugConfigurationFactory } from "../debugger/buildConfig";

/** Workspace Folder events */
export enum TestKind {
    // run tests serially
    standard = "Standard",
    // run tests in parallel
    parallel = "Parallel",
    // run tests and extract test coverage
    coverage = "Coverage",
    // run tests and extract test coverage
    debug = "Debug",
}

export enum RunProfileName {
    run = "Run Tests",
    runParallel = "Run Tests (Parallel)",
    coverage = "Test Coverage",
    debug = "Debug Tests",
}

export enum TestLibrary {
    xctest = "XCTest",
    swiftTesting = "swift-testing",
}

export class TestRunProxy {
    private testRun?: vscode.TestRun;
    private addedTestItems: { testClass: TestClass; parentIndex: number }[] = [];
    private runStarted: boolean = false;
    private queuedOutput: string[] = [];
    private _testItems: vscode.TestItem[];
    public coverage: TestCoverage;

    // Allows for introspection on the state of TestItems after a test run.
    public runState = {
        failed: [] as {
            test: vscode.TestItem;
            message: vscode.TestMessage | readonly vscode.TestMessage[];
        }[],
        passed: [] as vscode.TestItem[],
        skipped: [] as vscode.TestItem[],
        errored: [] as vscode.TestItem[],
    };

    public get testItems(): vscode.TestItem[] {
        return this._testItems;
    }

    constructor(
        private testRunRequest: vscode.TestRunRequest,
        private controller: vscode.TestController,
        private args: TestRunArguments,
        private folderContext: FolderContext
    ) {
        this._testItems = args.testItems;
        this.coverage = new TestCoverage(folderContext);
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

                const added = upsertTestItem(this.controller, testClass, parent);

                // If we just update leaf nodes the root test controller never realizes that
                // items have updated. This may be a bug in VSCode. We can work around it by
                // re-adding the existing items back up the chain to refresh all the nodes along the way.
                let p = parent;
                while (p?.parent) {
                    p.parent.children.add(p);
                    p = p.parent;
                }

                return added;
            });

        this.testRun = this.controller.createTestRun(this.testRunRequest);
        this._testItems = [...this.testItems, ...addedTestItems];

        // Forward any output captured before the testRun was created.
        for (const outputLine of this.queuedOutput) {
            this.testRun.appendOutput(outputLine);
        }
        this.queuedOutput = [];

        for (const test of this.testItems) {
            this.testRun.enqueued(test);
        }
    };

    public addParameterizedTestCase = (testClass: TestClass, parentIndex: number) => {
        this.addedTestItems.push({ testClass, parentIndex });
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
        this.testRun?.end();
    }

    public appendOutput(output: string) {
        if (this.testRun) {
            this.testRun.appendOutput(output);
        } else {
            this.queuedOutput.push(output);
        }
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
    private testRun: TestRunProxy;
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
        private controller: vscode.TestController
    ) {
        this.testArgs = new TestRunArguments(this.ensureRequestIncludesTests(this.request));
        this.testRun = new TestRunProxy(request, controller, this.testArgs, folderContext);
        this.xcTestOutputParser =
            testKind === TestKind.parallel
                ? new ParallelXCTestOutputParser(
                      this.folderContext.workspaceContext.toolchain.hasMultiLineParallelTestOutput
                  )
                : new XCTestOutputParser();
        this.swiftTestOutputParser = new SwiftTestingOutputParser(
            this.testRun.testRunStarted,
            this.testRun.addParameterizedTestCase
        );
    }

    /**
     * If the request has no test items to include in the run,
     * default to usig all the items in the `TestController`.
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
            // Add non-debug profile
            controller.createRunProfile(
                RunProfileName.run,
                vscode.TestRunProfileKind.Run,
                async (request, token) => {
                    const runner = new TestRunner(
                        TestKind.standard,
                        request,
                        folderContext,
                        controller
                    );
                    onCreateTestRun.fire(runner.testRun);
                    await runner.runHandler(token);
                },
                true,
                runnableTag
            ),
            // Add non-debug profile
            controller.createRunProfile(
                RunProfileName.runParallel,
                vscode.TestRunProfileKind.Run,
                async (request, token) => {
                    const runner = new TestRunner(
                        TestKind.parallel,
                        request,
                        folderContext,
                        controller
                    );
                    onCreateTestRun.fire(runner.testRun);
                    await runner.runHandler(token);
                },
                false,
                runnableTag
            ),
            // Add coverage profile
            controller.createRunProfile(
                RunProfileName.coverage,
                vscode.TestRunProfileKind.Coverage,
                async (request, token) => {
                    const runner = new TestRunner(
                        TestKind.coverage,
                        request,
                        folderContext,
                        controller
                    );
                    onCreateTestRun.fire(runner.testRun);
                    if (request.profile) {
                        request.profile.loadDetailedCoverage = async (testRun, fileCoverage) => {
                            return runner.testRun.coverage.loadDetailedCoverage(fileCoverage.uri);
                        };
                    }
                    await runner.runHandler(token);
                    await runner.testRun.computeCoverage();
                    await vscode.commands.executeCommand("testing.openCoverage");
                },
                false,
                runnableTag
            ),
            // Add debug profile
            controller.createRunProfile(
                RunProfileName.debug,
                vscode.TestRunProfileKind.Debug,
                async (request, token) => {
                    const runner = new TestRunner(
                        TestKind.debug,
                        request,
                        folderContext,
                        controller
                    );
                    onCreateTestRun.fire(runner.testRun);
                    await runner.runHandler(token);
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
    async runHandler(token: vscode.CancellationToken) {
        const runState = new TestRunnerTestRunState(this.testRun);
        try {
            if (this.testKind === TestKind.debug) {
                await this.debugSession(token, runState);
            } else {
                await this.runSession(token, runState);
            }
        } catch (error) {
            this.workspaceContext.outputChannel.log(`Error: ${getErrorDescription(error)}`);
            this.testRun.appendOutput(`\r\nError: ${getErrorDescription(error)}`);
        }

        await this.testRun.end();
    }

    /** Run test session without attaching to a debugger */
    async runSession(token: vscode.CancellationToken, runState: TestRunnerTestRunState) {
        // Run swift-testing first, then XCTest.
        // swift-testing being parallel by default should help these run faster.
        if (this.testArgs.hasSwiftTestingTests) {
            const fifoPipePath =
                process.platform === "win32"
                    ? `\\\\.\\pipe\\vscodemkfifo-${Date.now()}`
                    : path.join(os.tmpdir(), `vscodemkfifo-${Date.now()}`);

            await TemporaryFolder.withNamedTemporaryFile(fifoPipePath, async () => {
                // macOS/Linux require us to create the named pipe before we use it.
                // Windows just lets us communicate by specifying a pipe path without any ceremony.
                if (process.platform !== "win32") {
                    await execFile("mkfifo", [fifoPipePath], undefined, this.folderContext);
                }

                const testBuildConfig = TestingDebugConfigurationFactory.swiftTestingConfig(
                    this.folderContext,
                    fifoPipePath,
                    this.testKind,
                    this.testArgs.swiftTestArgs,
                    true
                );

                if (testBuildConfig === null) {
                    return;
                }

                // Output test from stream
                const outputStream = new stream.Writable({
                    write: (chunk, encoding, next) => {
                        const text = chunk.toString();
                        this.testRun.appendOutput(text.replace(/\n/g, "\r\n"));
                        next();
                    },
                });

                if (token.isCancellationRequested) {
                    outputStream.end();
                    return;
                }

                // Watch the pipe for JSONL output and parse the events into test explorer updates.
                // The await simply waits for the watching to be configured.
                await this.swiftTestOutputParser.watch(fifoPipePath, runState);

                await this.launchTests(
                    runState,
                    this.testKind === TestKind.parallel ? TestKind.standard : this.testKind,
                    token,
                    outputStream,
                    testBuildConfig,
                    TestLibrary.swiftTesting
                );
            });
        }

        if (this.testArgs.hasXCTests) {
            const testBuildConfig = TestingDebugConfigurationFactory.xcTestConfig(
                this.folderContext,
                this.testKind,
                this.testArgs.xcTestArgs,
                true
            );
            if (testBuildConfig === null) {
                return;
            }
            // Parse output from stream and output to log
            const parsedOutputStream = new stream.Writable({
                write: (chunk, encoding, next) => {
                    const text = chunk.toString();
                    this.testRun.appendOutput(text.replace(/\n/g, "\r\n"));
                    this.xcTestOutputParser.parseResult(text, runState);
                    next();
                },
            });

            if (token.isCancellationRequested) {
                parsedOutputStream.end();
                return;
            }

            // XCTestRuns are started immediately
            this.testRun.testRunStarted();

            await this.launchTests(
                runState,
                this.testKind,
                token,
                parsedOutputStream,
                testBuildConfig,
                TestLibrary.xctest
            );
        }
    }

    private async launchTests(
        runState: TestRunnerTestRunState,
        testKind: TestKind,
        token: vscode.CancellationToken,
        outputStream: stream.Writable,
        testBuildConfig: vscode.DebugConfiguration,
        testLibrary: TestLibrary
    ) {
        try {
            switch (testKind) {
                case TestKind.coverage:
                    await this.runCoverageSession(
                        token,
                        outputStream,
                        testBuildConfig,
                        testLibrary
                    );
                    break;
                case TestKind.parallel:
                    await this.runParallelSession(token, outputStream, testBuildConfig, runState);
                    break;
                default:
                    await this.runStandardSession(token, outputStream, testBuildConfig, testKind);
                    break;
            }
        } catch (error) {
            // Test failures result in error code 1
            if (error !== 1) {
                this.testRun.appendOutput(`\r\nError: ${getErrorDescription(error)}`);
            } else {
                this.swiftTestOutputParser.close();
            }
        } finally {
            outputStream.end();
        }
    }

    /** Run tests outside of debugger */
    async runStandardSession(
        token: vscode.CancellationToken,
        outputStream: stream.Writable,
        testBuildConfig: vscode.DebugConfiguration,
        testKind: TestKind
    ) {
        return new Promise<void>((resolve, reject) => {
            const args = testBuildConfig.args ?? [];
            this.folderContext?.workspaceContext.outputChannel.logDiagnostic(
                `Exec: ${testBuildConfig.program} ${args.join(" ")}`,
                this.folderContext.name
            );

            let kindLabel: string;
            switch (testKind) {
                case TestKind.coverage:
                    kindLabel = " With Code Coverage";
                    break;
                case TestKind.parallel:
                    kindLabel = " In Parallel";
                    break;
                case TestKind.debug:
                    kindLabel = "For Debugging";
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
                    presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
                },
                this.folderContext.workspaceContext.toolchain,
                { ...process.env, ...testBuildConfig.env }
            );

            task.execution.onDidWrite(str => {
                const replaced = str
                    .replace("[1/1] Planning build", "") // Work around SPM still emitting progress when doing --no-build.
                    .replace(
                        /LLVM Profile Error: Failed to write file "default.profraw": Operation not permitted\r\n/gm,
                        ""
                    ); // Work around benign LLVM coverage warnings
                outputStream.write(replaced);
            });

            let cancellation: vscode.Disposable;
            task.execution.onDidClose(code => {
                if (cancellation) {
                    cancellation.dispose();
                }

                // undefined or 0 are viewed as success
                if (!code) {
                    resolve();
                } else {
                    reject(code);
                }
            });

            this.folderContext.taskQueue.queueOperation(new TaskOperation(task), token);
        });
    }

    /** Run tests with code coverage, and parse coverage results */
    async runCoverageSession(
        token: vscode.CancellationToken,
        outputStream: stream.Writable,
        testBuildConfig: vscode.DebugConfiguration,
        testLibrary: TestLibrary
    ) {
        try {
            await this.runStandardSession(token, outputStream, testBuildConfig, TestKind.coverage);
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
        token: vscode.CancellationToken,
        outputStream: stream.Writable,
        testBuildConfig: vscode.DebugConfiguration,
        runState: TestRunnerTestRunState
    ) {
        await this.workspaceContext.tempFolder.withTemporaryFile("xml", async filename => {
            const args = [...(testBuildConfig.args ?? []), "--xunit-output", filename];

            try {
                testBuildConfig.args = await this.runStandardSession(
                    token,
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
            const results = await xUnitParser.parse(buffer, runState);
            if (results) {
                this.testRun.appendOutput(
                    `\r\nExecuted ${results.tests} tests, with ${results.failures} failures and ${results.errors} errors.\r\n`
                );
            }
        });
    }

    /** Run test session inside debugger */
    async debugSession(token: vscode.CancellationToken, runState: TestRunnerTestRunState) {
        const buildConfigs: Array<vscode.DebugConfiguration | undefined> = [];

        const fifoPipePath =
            process.platform === "win32"
                ? `\\\\.\\pipe\\vscodemkfifo-${Date.now()}`
                : path.join(os.tmpdir(), `vscodemkfifo-${Date.now()}`);

        await TemporaryFolder.withNamedTemporaryFile(fifoPipePath, async () => {
            // macOS/Linux require us to create the named pipe before we use it.
            // Windows just lets us communicate by specifying a pipe path without any ceremony.
            if (process.platform !== "win32") {
                await execFile("mkfifo", [fifoPipePath], undefined, this.folderContext);
            }

            if (this.testArgs.hasSwiftTestingTests) {
                const swiftTestBuildConfig = TestingDebugConfigurationFactory.swiftTestingConfig(
                    this.folderContext,
                    fifoPipePath,
                    TestKind.debug,
                    this.testArgs.swiftTestArgs,
                    true
                );

                if (swiftTestBuildConfig !== null) {
                    // output test build configuration
                    if (configuration.diagnostics) {
                        const configJSON = JSON.stringify(swiftTestBuildConfig);
                        this.workspaceContext.outputChannel.logDiagnostic(
                            `swift-testing Debug Config: ${configJSON}`,
                            this.folderContext.name
                        );
                    }

                    // output test build configuration
                    if (configuration.diagnostics) {
                        const configJSON = JSON.stringify(swiftTestBuildConfig);
                        this.workspaceContext.outputChannel.logDiagnostic(
                            `swift-testing Debug Config: ${configJSON}`,
                            this.folderContext.name
                        );
                    }
                    // Watch the pipe for JSONL output and parse the events into test explorer updates.
                    // The await simply waits for the watching to be configured.
                    await this.swiftTestOutputParser.watch(fifoPipePath, runState);

                    swiftTestBuildConfig.testType = TestLibrary.swiftTesting;
                    buildConfigs.push(swiftTestBuildConfig);
                }
            }

            // create launch config for testing
            if (this.testArgs.hasXCTests) {
                const xcTestBuildConfig = TestingDebugConfigurationFactory.xcTestConfig(
                    this.folderContext,
                    TestKind.debug,
                    this.testArgs.xcTestArgs,
                    true
                );

                if (xcTestBuildConfig !== null) {
                    // output test build configuration
                    if (configuration.diagnostics) {
                        const configJSON = JSON.stringify(xcTestBuildConfig);
                        this.workspaceContext.outputChannel.logDiagnostic(
                            `XCTest Debug Config: ${configJSON}`,
                            this.folderContext.name
                        );
                    }

                    xcTestBuildConfig.testType = TestLibrary.xctest;

                    buildConfigs.push(xcTestBuildConfig);
                }
            }

            const validBuildConfigs = buildConfigs.filter(
                config => config !== null
            ) as vscode.DebugConfiguration[];

            const subscriptions: vscode.Disposable[] = [];

            const debugRuns = validBuildConfigs.map(config => {
                return () =>
                    new Promise<void>((resolve, reject) => {
                        // add cancelation
                        const startSession = vscode.debug.onDidStartDebugSession(session => {
                            if (config.testType === TestLibrary.xctest) {
                                this.testRun.testRunStarted();
                            }

                            this.workspaceContext.outputChannel.logDiagnostic(
                                "Start Test Debugging",
                                this.folderContext.name
                            );
                            LoggingDebugAdapterTracker.setDebugSessionCallback(session, output => {
                                this.testRun.appendOutput(output);
                                if (config.testType === TestLibrary.xctest) {
                                    this.xcTestOutputParser.parseResult(output, runState);
                                }
                            });
                            const cancellation = token.onCancellationRequested(() => {
                                this.workspaceContext.outputChannel.logDiagnostic(
                                    "Test Debugging Cancelled",
                                    this.folderContext.name
                                );
                                vscode.debug.stopDebugging(session);
                            });
                            subscriptions.push(cancellation);
                        });
                        subscriptions.push(startSession);

                        vscode.debug
                            .startDebugging(this.folderContext.workspaceFolder, config)
                            .then(
                                started => {
                                    if (started) {
                                        // show test results pane
                                        vscode.commands.executeCommand(
                                            "testing.showMostRecentOutput"
                                        );

                                        const terminateSession =
                                            vscode.debug.onDidTerminateDebugSession(async () => {
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
                                        reject();
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
        const testItem = this.testRun.testItems[index];
        this.testRun.started(testItem);
        this.currentTestItem = testItem;
        this.startTimes.set(index, startTime);
    }

    // set test item to have passed
    completed(index: number, timing: { duration: number } | { timestamp: number }) {
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

        const issues = this.issues.get(index) ?? [];
        if (issues.length > 0) {
            const allUnknownIssues = issues.filter(({ isKnown }) => !isKnown);
            if (allUnknownIssues.length === 0) {
                this.testRun.skipped(test);
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

    recordIssue(
        index: number,
        message: string | vscode.MarkdownString,
        isKnown: boolean = false,
        location?: vscode.Location
    ) {
        const msg = new vscode.TestMessage(message);
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
        this.testRun.skipped(this.testRun.testItems[index]);
        this.lastTestItem = this.currentTestItem;
        this.currentTestItem = undefined;
    }

    // started suite
    startedSuite() {
        // Nothing to do here
    }
    // passed suite
    passedSuite() {
        // Nothing to do here
    }
    // failed suite
    failedSuite() {
        // Nothing to do here
    }
}
