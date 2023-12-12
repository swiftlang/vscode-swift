//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2022 the VSCode Swift project authors
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
import { createTestConfiguration, createDarwinTestConfiguration } from "../debugger/launch";
import { FolderContext } from "../FolderContext";
import { ExecError, execFileStreamOutput, getErrorDescription } from "../utilities/utilities";
import { getBuildAllTask } from "../SwiftTaskProvider";
import configuration from "../configuration";
import { WorkspaceContext } from "../WorkspaceContext";
import { iTestRunState, TestOutputParser } from "./TestOutputParser";
import { Version } from "../utilities/version";
import { LoggingDebugAdapterTracker } from "../debugger/logTracker";
import { TaskOperation } from "../TaskQueue";

/** Class used to run tests */
export class TestRunner {
    private testRun: vscode.TestRun;
    private testItems: vscode.TestItem[];
    private testArgs: string[];
    private testOutputParser: TestOutputParser;

    /**
     * Constructor for TestRunner
     * @param request Test run request
     * @param folderContext Folder tests are being run in
     * @param controller Test controller
     */
    constructor(
        private request: vscode.TestRunRequest,
        private folderContext: FolderContext,
        private controller: vscode.TestController
    ) {
        this.testRun = this.controller.createTestRun(this.request);
        const lists = this.createTestLists();
        this.testItems = lists.testItems;
        this.testArgs = lists.testArgs;
        this.testOutputParser = new TestOutputParser();
    }

    get workspaceContext(): WorkspaceContext {
        return this.folderContext.workspaceContext;
    }

    /**
     * Setup debug and run test profiles
     * @param controller Test controller
     * @param folderContext Folder tests are running in
     */
    static setupProfiles(controller: vscode.TestController, folderContext: FolderContext) {
        // Add non-debug profile
        controller.createRunProfile(
            "Run Tests",
            vscode.TestRunProfileKind.Run,
            async (request, token) => {
                const runner = new TestRunner(request, folderContext, controller);
                await runner.runHandler(false, false, token);
            },
            true
        );
        // Add coverage profile
        controller.createRunProfile(
            "Test Coverage",
            vscode.TestRunProfileKind.Run,
            async (request, token) => {
                const runner = new TestRunner(request, folderContext, controller);
                await runner.runHandler(false, true, token);
            }
        );
        // Add debug profile
        controller.createRunProfile(
            "Debug Tests",
            vscode.TestRunProfileKind.Debug,
            async (request, token) => {
                const runner = new TestRunner(request, folderContext, controller);
                await runner.runHandler(true, false, token);
            }
        );
    }

    /** Construct test item list from TestRequest
     * @returns list of test items to run and list of test for XCTest arguments
     */
    createTestLists(): { testItems: vscode.TestItem[]; testArgs: string[] } {
        const queue: vscode.TestItem[] = [];

        // Loop through all included tests, or all known tests, and add them to our queue
        if (this.request.include && this.request.include.length > 0) {
            this.request.include.forEach(test => queue.push(test));
        } else {
            this.controller.items.forEach(test => queue.push(test));
        }

        // create test list
        const list: vscode.TestItem[] = [];
        const queue2: vscode.TestItem[] = [];
        while (queue.length > 0) {
            const test = queue.pop()!;

            // Skip tests the user asked to exclude
            if (this.request.exclude?.includes(test)) {
                continue;
            }

            // is this a test item for a TestCase class, it has one parent
            // (module and controller)
            if (test.parent && !test.parent?.parent) {
                // if this test item doesn't include an excluded test add the
                // test item to the list and then add its children to the queue2
                // list to be processed in the next loop
                if (
                    !this.request.exclude?.find(item => {
                        return item.id.startsWith(test.id);
                    })
                ) {
                    list.push(test);
                    if (test.children.size > 0) {
                        test.children.forEach(test => queue2.push(test));
                    }
                    continue;
                }
            }

            if (test.children.size > 0) {
                test.children.forEach(test => queue.push(test));
                continue;
            }
            list.push(test);
        }
        // construct list of arguments from test item list ids
        let argumentList: string[] = [];
        // if test list has been filtered in some way then construct list of tests
        // for XCTest arguments
        if (
            (this.request.include && this.request.include.length > 0) ||
            (this.request.exclude && this.request.exclude.length > 0)
        ) {
            argumentList = list.map(item => item.id);
        }

        // add leaf test items, not added in previous loop. A full set of test
        // items being tested is needed when parsing the test output
        while (queue2.length > 0) {
            const test = queue2.pop()!;

            // Skip tests the user asked to exclude
            if (this.request.exclude?.includes(test)) {
                continue;
            }

            list.push(test);
        }
        return { testItems: list, testArgs: argumentList };
    }

    /**
     * Test run handler. Run a series of tests and extracts the results from the output
     * @param shouldDebug Should we run the debugger
     * @param token Cancellation token
     * @returns When complete
     */
    async runHandler(
        shouldDebug: boolean,
        generateCoverage: boolean,
        token: vscode.CancellationToken
    ) {
        const runState = new TestRunState(this.testItems, this.testRun, this.folderContext);
        try {
            // run associated build task
            // don't do this if generating code test coverage data as it
            // will rebuild everything again
            if (!generateCoverage) {
                const task = await getBuildAllTask(this.folderContext);
                const exitCode = await this.folderContext.taskQueue.queueOperation(
                    new TaskOperation(task),
                    token
                );

                // if build failed then exit
                if (exitCode === undefined || exitCode !== 0) {
                    this.testRun.end();
                    return;
                }
            }
            this.setTestsEnqueued();

            if (shouldDebug) {
                await this.debugSession(token, runState);
            } else {
                await this.runSession(token, generateCoverage, runState);
            }
        } catch (error) {
            // is error returned from child_process.exec call and command failed then
            // skip reporting error
            const execError = error as ExecError;
            if (
                execError &&
                execError.error &&
                execError.error.message.startsWith("Command failed")
            ) {
                this.testRun.end();
                return;
            }
            this.testRun.appendOutput(`\r\nError: ${getErrorDescription(error)}`);
        }

        this.testRun.end();
    }

    /**
     * Edit launch configuration to run tests
     * @param debugging Do we need this configuration for debugging
     * @param outputFile Debug output file
     * @returns
     */
    private createLaunchConfigurationForTesting(
        debugging: boolean
    ): vscode.DebugConfiguration | null {
        const testList = this.testArgs.join(",");

        if (process.platform === "darwin") {
            // if debugging on macOS with Swift 5.6 we need to create a custom launch
            // configuration so we can set the system architecture
            const swiftVersion = this.workspaceContext.toolchain.swiftVersion;
            if (
                debugging &&
                swiftVersion.isLessThan(new Version(5, 7, 0)) &&
                swiftVersion.isGreaterThanOrEqual(new Version(5, 6, 0))
            ) {
                let testFilterArg: string;
                if (testList.length > 0) {
                    testFilterArg = `-XCTest ${testList}`;
                } else {
                    testFilterArg = "";
                }
                const testBuildConfig = createDarwinTestConfiguration(
                    this.folderContext,
                    testFilterArg
                );
                if (testBuildConfig === null) {
                    return null;
                }
                return testBuildConfig;
            } else {
                const testBuildConfig = createTestConfiguration(this.folderContext, true);
                if (testBuildConfig === null) {
                    return null;
                }

                if (testList.length > 0) {
                    testBuildConfig.args = ["-XCTest", testList, ...testBuildConfig.args];
                }
                // output test logging to debug console so we can catch it with a tracker
                testBuildConfig.terminal = "console";
                return testBuildConfig;
            }
        } else {
            const testBuildConfig = createTestConfiguration(this.folderContext, true);
            if (testBuildConfig === null) {
                return null;
            }

            if (testList.length > 0) {
                testBuildConfig.args = [testList];
            }
            // output test logging to debug console so we can catch it with a tracker
            testBuildConfig.terminal = "console";
            return testBuildConfig;
        }
    }

    /** Run test session without attaching to a debugger */
    async runSession(
        token: vscode.CancellationToken,
        generateCoverage: boolean,
        runState: TestRunState
    ) {
        // create launch config for testing
        const testBuildConfig = this.createLaunchConfigurationForTesting(false);
        if (testBuildConfig === null) {
            return;
        }

        // Parse output from stream and output to log
        const parsedOutputStream = new stream.Writable({
            write: (chunk, encoding, next) => {
                const text = chunk.toString();
                this.testRun.appendOutput(text.replace(/\n/g, "\r\n"));
                if (process.platform === "darwin") {
                    this.testOutputParser.parseResultDarwin(text, runState);
                } else {
                    this.testOutputParser.parseResultNonDarwin(text, runState);
                }
                next();
            },
        });

        // Output test from stream
        const outputStream = new stream.Writable({
            write: (chunk, encoding, next) => {
                const text = chunk.toString();
                this.testRun.appendOutput(text.replace(/\n/g, "\r\n"));
                next();
            },
        });

        // Darwin outputs XCTest output to stderr, Linux outputs XCTest output to stdout
        let stdout: stream.Writable;
        let stderr: stream.Writable;
        if (process.platform === "darwin") {
            stdout = parsedOutputStream;
            stderr = outputStream;
        } else {
            stdout = parsedOutputStream;
            stderr = outputStream;
        }

        if (token.isCancellationRequested) {
            parsedOutputStream.end();
            outputStream.end();
            return;
        }

        this.testRun.appendOutput(`> Test run started at ${new Date().toLocaleString()} <\r\n\r\n`);
        try {
            if (generateCoverage) {
                const filterArgs = this.testArgs.flatMap(arg => ["--filter", arg]);
                const args = ["test", "--enable-code-coverage"];
                await execFileStreamOutput(
                    this.workspaceContext.toolchain.getToolchainExecutable("swift"),
                    [...args, ...filterArgs],
                    stdout,
                    stderr,
                    token,
                    {
                        cwd: testBuildConfig.cwd,
                        env: { ...process.env, ...testBuildConfig.env },
                        maxBuffer: 16 * 1024 * 1024,
                    },
                    this.folderContext,
                    false,
                    "SIGINT" // use SIGINT to kill process as it is a child process of `swift test`
                );
            } else {
                if (process.platform === "darwin") {
                    stdout = outputStream;
                    stderr = parsedOutputStream;
                }
                await execFileStreamOutput(
                    testBuildConfig.program,
                    testBuildConfig.args ?? [],
                    stdout,
                    stderr,
                    token,
                    {
                        cwd: testBuildConfig.cwd,
                        env: { ...process.env, ...testBuildConfig.env },
                        maxBuffer: 16 * 1024 * 1024,
                    },
                    this.folderContext,
                    false,
                    "SIGKILL"
                );
            }
        } catch (error) {
            outputStream.end();
            parsedOutputStream.end();
            if (generateCoverage) {
                await this.folderContext.lcovResults.generate();
                if (configuration.displayCoverageReportAfterRun) {
                    this.workspaceContext.testCoverageDocumentProvider.show(this.folderContext);
                }
            }
            // report error
            if (runState.currentTestItem) {
                const message = new vscode.TestMessage(getErrorDescription(error));
                this.testRun.errored(runState.currentTestItem, message);
            }
            throw error;
        }

        outputStream.end();
        parsedOutputStream.end();
        if (generateCoverage) {
            await this.folderContext.lcovResults.generate();
            if (configuration.displayCoverageReportAfterRun) {
                this.workspaceContext.testCoverageDocumentProvider.show(this.folderContext);
            }
        }
    }

    /** Run test session inside debugger */
    async debugSession(token: vscode.CancellationToken, runState: TestRunState) {
        // create launch config for testing
        const testBuildConfig = this.createLaunchConfigurationForTesting(true);
        if (testBuildConfig === null) {
            return;
        }

        // given we have already run a build task there is no need to have a pre launch task
        // to build the tests
        testBuildConfig.preLaunchTask = undefined;

        // output test build configuration
        if (configuration.diagnostics) {
            const configJSON = JSON.stringify(testBuildConfig);
            this.workspaceContext.outputChannel.logDiagnostic(
                `Debug Config: ${configJSON}`,
                this.folderContext.name
            );
        }

        const subscriptions: vscode.Disposable[] = [];
        // add cancelation
        const startSession = vscode.debug.onDidStartDebugSession(session => {
            this.workspaceContext.outputChannel.logDiagnostic(
                "Start Test Debugging",
                this.folderContext.name
            );
            LoggingDebugAdapterTracker.setDebugSessionCallback(session, output => {
                this.testRun.appendOutput(output);
                if (process.platform === "darwin") {
                    this.testOutputParser.parseResultDarwin(output, runState);
                } else {
                    this.testOutputParser.parseResultNonDarwin(output, runState);
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

        return new Promise<void>((resolve, reject) => {
            vscode.debug.startDebugging(this.folderContext.workspaceFolder, testBuildConfig).then(
                started => {
                    if (started) {
                        this.testRun.appendOutput(
                            `> Test run started at ${new Date().toLocaleString()} <\r\n\r\n`
                        );
                        // show test results pane
                        vscode.commands.executeCommand("testing.showMostRecentOutput");

                        const terminateSession = vscode.debug.onDidTerminateDebugSession(
                            async () => {
                                this.workspaceContext.outputChannel.logDiagnostic(
                                    "Stop Test Debugging",
                                    this.folderContext.name
                                );
                                // dispose terminate debug handler
                                subscriptions.forEach(sub => sub.dispose());
                                resolve();
                            }
                        );
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
    }

    setTestsEnqueued() {
        for (const test of this.testItems) {
            this.testRun.enqueued(test);
        }
    }
}

/**
 * Store state of current test run output parse
 */
class TestRunState implements iTestRunState {
    constructor(
        public testItems: vscode.TestItem[],
        private testRun: vscode.TestRun,
        private folderContext: FolderContext
    ) {}

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

    /** Get test item index from id for Darwin platforms */
    getTestItemIndexDarwin(id: string): number {
        return this.testItems.findIndex(item => item.id === id);
    }

    /**
     * Get test item index from id for non Darwin platforms. It is a little harder to
     * be certain we have the correct test item on non Darwin platforms as the target
     * name is not included in the id
     */
    getTestItemIndexNonDarwin(id: string, filename?: string): number {
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

    // set test item to be started
    started(index: number): void {
        this.testRun.started(this.testItems[index]);
        this.currentTestItem = this.testItems[index];
    }

    // set test item to have passed
    passed(index: number, duration: number): void {
        this.testRun.passed(this.testItems[index], duration * 1000);
        this.testItems.splice(index, 1);
        this.lastTestItem = this.currentTestItem;
        this.currentTestItem = undefined;
    }

    // set test item to be failed
    failed(index: number, message: string, location?: { file: string; line: number }): void {
        if (location) {
            const testMessage = new vscode.TestMessage(message);
            testMessage.location = new vscode.Location(
                vscode.Uri.file(location.file),
                new vscode.Position(location.line - 1, 0)
            );
            this.testRun.failed(this.testItems[index], testMessage);
        } else {
            this.testRun.failed(this.testItems[index], new vscode.TestMessage(message));
        }
        this.testItems.splice(index, 1);
        this.lastTestItem = this.currentTestItem;
        this.currentTestItem = undefined;
    }

    // set test item to have been skipped
    skipped(index: number): void {
        this.testRun.skipped(this.testItems[index]);
        this.testItems.splice(index, 1);
        this.lastTestItem = this.currentTestItem;
        this.currentTestItem = undefined;
    }

    // started suite
    startedSuite() {
        // Nothing to do here
    }
    // passed suite
    passedSuite(name: string) {
        const lastClassTestItem = this.lastTestItem?.parent;
        if (lastClassTestItem && lastClassTestItem.id.endsWith(`.${name}`)) {
            this.testRun.passed(lastClassTestItem);
        }
    }
    // failed suite
    failedSuite(name: string) {
        const lastClassTestItem = this.lastTestItem?.parent;
        if (lastClassTestItem && lastClassTestItem.id.endsWith(`.${name}`)) {
            this.testRun.failed(lastClassTestItem, []);
        }
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
