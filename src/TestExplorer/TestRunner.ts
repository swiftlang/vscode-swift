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
import * as fs from "fs";
import * as asyncfs from "fs/promises";
import * as path from "path";
import * as stream from "stream";
import { createTestConfiguration, createDarwinTestConfiguration } from "../debugger/launch";
import { FolderContext } from "../FolderContext";
import {
    buildDirectoryFromWorkspacePath,
    ExecError,
    execFileStreamOutput,
    getErrorDescription,
    getSwiftExecutable,
} from "../utilities/utilities";
import { getBuildAllTask } from "../SwiftTaskProvider";
import configuration from "../configuration";
import { WorkspaceContext } from "../WorkspaceContext";

/** Class used to run tests */
export class TestRunner {
    private testRun: vscode.TestRun;
    private testItems: vscode.TestItem[];
    private testArgs: string[];

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
        const runState = new TestRunState();
        try {
            // run associated build task
            // don't do this if generating code test coverage data as it
            // will rebuild everything again
            if (!generateCoverage) {
                const task = await getBuildAllTask(this.folderContext);
                const exitCode = await this.folderContext.taskQueue.queueOperation(
                    { task: task },
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
            // report error
            if (runState.currentTestItem) {
                const message = new vscode.TestMessage(getErrorDescription(error));
                this.testRun.errored(runState.currentTestItem, message);
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
        debugging: boolean,
        outputFile: string | null = null
    ): vscode.DebugConfiguration | null {
        const testList = this.testArgs.join(",");

        if (process.platform === "darwin") {
            let testFilterArg: string;
            if (testList.length > 0) {
                testFilterArg = `-XCTest ${testList}`;
            } else {
                testFilterArg = "";
            }
            // if debugging on macOS need to create a custom launch configuration so we can set the
            // the system architecture
            if (debugging && outputFile) {
                const testBuildConfig = createDarwinTestConfiguration(
                    this.folderContext,
                    testFilterArg,
                    outputFile
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
                // send stdout to testOutputPath. Cannot send both stdout and stderr to same file as it
                // doesn't come out in the correct order
                testBuildConfig.stdio = [null, null, outputFile];
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
            // send stdout to testOutputPath. Cannot send both stdout and stderr to same file as it
            // doesn't come out in the correct order
            testBuildConfig.stdio = [null, outputFile, null];
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
                    this.parseResultDarwin(text, runState);
                } else {
                    this.parseResultNonDarwin(text, runState);
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
        // show test results pane
        vscode.commands.executeCommand("testing.showMostRecentOutput");
        const filterArgs = this.testArgs.flatMap(arg => ["--filter", arg]);
        const args = ["test"];
        if (generateCoverage) {
            args.push("--enable-code-coverage");
        } else {
            args.push("--skip-build");
        }
        try {
            await execFileStreamOutput(
                getSwiftExecutable(),
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
                false
            );
        } catch (error) {
            outputStream.end();
            parsedOutputStream.end();
            if (generateCoverage) {
                await this.generateCodeCoverage();
            }
            throw error;
        }

        outputStream.end();
        parsedOutputStream.end();
        if (generateCoverage) {
            await this.generateCodeCoverage();
        }
    }

    /** Run test session inside debugger */
    async debugSession(token: vscode.CancellationToken, runState: TestRunState) {
        const testOutputPath = this.workspaceContext.tempFolder.filename("TestOutput", "txt");
        // create launch config for testing
        const testBuildConfig = this.createLaunchConfigurationForTesting(true, testOutputPath);
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
                                try {
                                    if (!token.isCancellationRequested) {
                                        const debugOutput = await asyncfs.readFile(testOutputPath, {
                                            encoding: "utf8",
                                        });
                                        this.testRun.appendOutput(
                                            debugOutput.replace(/\n/g, "\r\n")
                                        );
                                        if (process.platform === "darwin") {
                                            this.parseResultDarwin(debugOutput, runState);
                                        } else {
                                            this.parseResultNonDarwin(debugOutput, runState);
                                        }
                                    }
                                    asyncfs.rm(testOutputPath);
                                } catch {
                                    // ignore error
                                }
                                // dispose terminate debug handler
                                subscriptions.forEach(sub => sub.dispose());
                                resolve();
                            }
                        );
                        subscriptions.push(terminateSession);
                    } else {
                        asyncfs.rm(testOutputPath);
                        subscriptions.forEach(sub => sub.dispose());
                        reject();
                    }
                },
                reason => {
                    asyncfs.rm(testOutputPath);
                    subscriptions.forEach(sub => sub.dispose());
                    reject(reason);
                }
            );
        });
    }

    /**
     * Generate Code Coverage lcov file
     */
    async generateCodeCoverage() {
        const llvmCov = this.workspaceContext.toolchain.getToolchainExecutable("llvm-cov");
        const packageName = this.folderContext.swiftPackage.name;
        const buildDirectory = buildDirectoryFromWorkspacePath(
            this.folderContext.folder.fsPath,
            true
        );
        const lcovFileName = `${buildDirectory}/debug/codecov/lcov.info`;

        // Use WriteStream to log results
        const lcovStream = fs.createWriteStream(lcovFileName);

        try {
            let xctestFile = `${buildDirectory}/debug/${packageName}PackageTests.xctest`;
            if (process.platform === "darwin") {
                xctestFile += `/Contents/MacOs/${packageName}PackageTests`;
            }
            await execFileStreamOutput(
                llvmCov,
                [
                    "export",
                    "-format",
                    "lcov",
                    xctestFile,
                    "-ignore-filename-regex=Tests|.build|Snippets|Plugins",
                    `-instr-profile=${buildDirectory}/debug/codecov/default.profdata`,
                ],
                lcovStream,
                lcovStream,
                null,
                {
                    env: { ...process.env, ...configuration.swiftEnvironmentVariables },
                },
                this.folderContext
            );
        } catch (error) {
            this.testRun.appendOutput(`\r\nError: ${getErrorDescription(error)}`);
        }
        lcovStream.end();
    }

    /**
     * Parse results from `swift test` and update tests accordingly for Darwin platforms
     * @param output Output from `swift test`
     */
    private parseResultDarwin(output: string, runState: TestRunState) {
        const lines = output.split("\n").map(item => item.trim());

        for (const line of lines) {
            // Regex "Test Case '-[<test target> <class.function>]' started"
            const startedMatch = /^Test Case '-\[(\S+)\s(.*)\]' started./.exec(line);
            if (startedMatch) {
                const testId = `${startedMatch[1]}/${startedMatch[2]}`;
                this.startTest(this.getTestItemIndexDarwin(testId), runState);
                continue;
            }
            // Regex "Test Case '-[<test target> <class.function>]' passed (<duration> seconds)"
            const passedMatch = /^Test Case '-\[(\S+)\s(.*)\]' passed \((\d.*) seconds\)/.exec(
                line
            );
            if (passedMatch) {
                const testId = `${passedMatch[1]}/${passedMatch[2]}`;
                const duration: number = +passedMatch[3];
                this.passTest(this.getTestItemIndexDarwin(testId), duration, runState);
                continue;
            }
            // Regex "Test Case '-[<test target> <class.function>]' failed (<duration> seconds)"
            const failedMatch = /^Test Case '-\[(\S+)\s(.*)\]' failed \((\d.*) seconds\)/.exec(
                line
            );
            if (failedMatch) {
                const testId = `${failedMatch[1]}/${failedMatch[2]}`;
                const duration: number = +failedMatch[3];
                this.failTest(this.getTestItemIndexDarwin(testId), duration, runState);
                continue;
            }
            // Regex "<path/to/test>:<line number>: error: -[<test target> <class.function>] : <error>"
            const errorMatch = /^(.+):(\d+):\serror:\s-\[(\S+)\s(.*)\] : (.*)$/.exec(line);
            if (errorMatch) {
                const testId = `${errorMatch[3]}/${errorMatch[4]}`;
                this.startErrorMessage(
                    this.getTestItemIndexDarwin(testId),
                    errorMatch[5],
                    errorMatch[1],
                    errorMatch[2],
                    runState
                );
                continue;
            }
            // Regex "<path/to/test>:<line number>: -[<test target> <class.function>] : Test skipped"
            const skippedMatch = /^(.+):(\d+):\s-\[(\S+)\s(.*)\] : Test skipped/.exec(line);
            if (skippedMatch) {
                const testId = `${skippedMatch[3]}/${skippedMatch[4]}`;
                this.skipTest(this.getTestItemIndexDarwin(testId), runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' started"
            const startedSuiteMatch = /^Test Suite '(.*)' started/.exec(line);
            if (startedSuiteMatch) {
                this.startTestSuite(startedSuiteMatch[1], runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' passed"
            const passedSuiteMatch = /^Test Suite '(.*)' passed/.exec(line);
            if (passedSuiteMatch) {
                this.passTestSuite(passedSuiteMatch[1], runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' failed"
            const failedSuiteMatch = /^Test Suite '(.*)' failed/.exec(line);
            if (failedSuiteMatch) {
                this.failTestSuite(failedSuiteMatch[1], runState);
                continue;
            }
            // unrecognised output could be the continuation of a previous error message
            this.continueErrorMessage(line, runState);
        }
    }

    /**
     * Parse results from `swift test` and update tests accordingly for non Darwin
     * platforms eg Linux and Windows
     * @param output Output from `swift test`
     */
    private parseResultNonDarwin(output: string, runState: TestRunState) {
        const lines = output.split("\n").map(item => item.trim());

        // Non-Darwin test output does not include the test target name. The only way to find out
        // the target for a test is when it fails and returns a file name. If we find failed tests
        // first and then remove them from the list we cannot set them to passed by mistake.
        // We extract the file name from the error and use that to check whether the file belongs
        // to the target associated with the TestItem. This does not work 100% as the error could
        // occur in another target, so we revert to just searching for class and function name if
        // the above method is unsuccessful.
        for (const line of lines) {
            // Regex "Test Case '-[<test target> <class.function>]' started"
            const startedMatch = /^Test Case '(.*)\.(.*)' started/.exec(line);
            if (startedMatch) {
                const testName = `${startedMatch[1]}/${startedMatch[2]}`;
                const startedTestIndex = this.getTestItemIndexNonDarwin(testName, undefined);
                this.startTest(startedTestIndex, runState);
                continue;
            }
            // Regex "Test Case '-[<test target> <class.function>]' failed (<duration> seconds)"
            const failedMatch = /^Test Case '(.*)\.(.*)' failed \((\d.*) seconds\)/.exec(line);
            if (failedMatch) {
                const testName = `${failedMatch[1]}/${failedMatch[2]}`;
                const failedTestIndex = this.getTestItemIndexNonDarwin(testName, undefined);
                this.failTest(failedTestIndex, +failedMatch[3], runState);
                continue;
            }
            // Regex "<path/to/test>:<line number>: error: <class>.<function> : <error>"
            const errorMatch = /^(.+):(\d+):\serror:\s*(.*)\.(.*) : (.*)/.exec(line);
            if (errorMatch) {
                const testName = `${errorMatch[3]}/${errorMatch[4]}`;
                const failedTestIndex = this.getTestItemIndexNonDarwin(testName, errorMatch[1]);
                this.startErrorMessage(
                    failedTestIndex,
                    errorMatch[5],
                    errorMatch[1],
                    errorMatch[2],
                    runState
                );
                continue;
            }
            // Regex "<path/to/test>:<line number>: <class>.<function> : Test skipped:"
            const skippedMatch = /^(.+):(\d+):\s*(.*)\.(.*) : Test skipped:/.exec(line);
            if (skippedMatch) {
                const testName = `${skippedMatch[3]}/${skippedMatch[4]}`;
                const skippedTestIndex = this.getTestItemIndexNonDarwin(testName, skippedMatch[1]);
                this.skipTest(skippedTestIndex, runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' started"
            const startedSuiteMatch = /^Test Suite '(.*)' started/.exec(line);
            if (startedSuiteMatch) {
                this.startTestSuite(startedSuiteMatch[1], runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' passed"
            const passedSuiteMatch = /^Test Suite '(.*)' passed/.exec(line);
            if (passedSuiteMatch) {
                this.passTestSuite(passedSuiteMatch[1], runState);
                continue;
            }
            // Regex "Test Suite '-[<test target> <class.function>]' failed"
            const failedSuiteMatch = /^Test Suite '(.*)' failed/.exec(line);
            if (failedSuiteMatch) {
                this.failTestSuite(failedSuiteMatch[1], runState);
                continue;
            }
            // unrecognised output could be the continuation of a previous error message
            this.continueErrorMessage(line, runState);
        }

        // We need to run the passed checks in a separate pass to ensure we aren't in the situation
        // where there is a symbol clash between different test targets and set the wrong test
        // to be passed.
        for (const line of lines) {
            // Regex "Test Case '<class>.<function>' passed (<duration> seconds)"
            const passedMatch = /^Test Case '(.*)\.(.*)' passed \((\d.*) seconds\)/.exec(line);
            if (passedMatch) {
                const testName = `${passedMatch[1]}/${passedMatch[2]}`;
                const duration: number = +passedMatch[3];
                const passedTestIndex = this.getTestItemIndexNonDarwin(testName, undefined);
                this.passTest(passedTestIndex, duration, runState);
                continue;
            }
        }
    }

    /** Get test item index from id for Darwin platforms */
    private getTestItemIndexDarwin(id: string): number {
        return this.testItems.findIndex(item => item.id === id);
    }

    /**
     * Get test item index from id for non Darwin platforms. It is a little harder to
     * be certain we have the correct test item on non Darwin platforms as the target
     * name is not included in the id
     */
    private getTestItemIndexNonDarwin(name: string, filename?: string): number {
        let testIndex = -1;
        if (filename) {
            testIndex = this.testItems.findIndex(item =>
                this.isTestWithFilenameInTarget(name, filename, item)
            );
        }
        if (testIndex === -1) {
            testIndex = this.testItems.findIndex(item => item.id.endsWith(name));
        }
        return testIndex;
    }

    /** Flag a test suite has started */
    private startTestSuite(name: string, runState: TestRunState) {
        runState.suiteStack.push(name);
    }

    /** Flag a test suite has passed */
    private passTestSuite(name: string, runState: TestRunState) {
        runState.suiteStack.pop();
    }

    /** Flag a test suite has failed */
    private failTestSuite(name: string, runState: TestRunState) {
        runState.suiteStack.pop();
    }

    /** Flag we have started a test */
    private startTest(testIndex: number, runState: TestRunState) {
        if (testIndex !== -1) {
            this.testRun.started(this.testItems[testIndex]);
            runState.currentTestItem = this.testItems[testIndex];
            // clear error state
            runState.failedTest = undefined;
        }
    }

    /** Flag we have passed a test */
    private passTest(testIndex: number, duration: number, runState: TestRunState) {
        if (testIndex !== -1) {
            this.testRun.passed(this.testItems[testIndex], duration * 1000);
            this.testItems.splice(testIndex, 1);
        }
        runState.currentTestItem = undefined;
        runState.failedTest = undefined;
    }

    /** Start capture error message */
    private startErrorMessage(
        testIndex: number,
        message: string,
        file: string,
        lineNumber: string,
        runState: TestRunState
    ) {
        // if we have already found an error then skip this error
        if (runState.failedTest) {
            runState.currentTestItem === undefined;
            runState.failedTest.complete = true;
            return;
        }
        runState.failedTest = {
            testIndex: testIndex,
            message: message,
            file: file,
            lineNumber: parseInt(lineNumber) - 1,
            complete: false,
        };
    }

    /** continue capturing error message */
    private continueErrorMessage(message: string, runState: TestRunState) {
        // if we have a failed test message and it isn't complete
        if (runState.failedTest && runState.failedTest.complete !== true) {
            runState.failedTest.message += `\n${message}`;
        }
    }

    /** Flag we have failed a test */
    private failTest(testIndex: number, duration: number, runState: TestRunState) {
        if (testIndex !== -1) {
            if (runState.failedTest) {
                const testMessage = new vscode.TestMessage(runState.failedTest.message);
                testMessage.location = new vscode.Location(
                    vscode.Uri.file(runState.failedTest.file),
                    new vscode.Position(runState.failedTest.lineNumber, 0)
                );
                this.testRun.failed(this.testItems[testIndex], testMessage);
            } else {
                this.testRun.failed(this.testItems[testIndex], new vscode.TestMessage("Failed"));
            }
            this.testItems.splice(testIndex, 1);
        }
        runState.failedTest = undefined;
        runState.currentTestItem = undefined;
    }

    /** Flag we have skipped a test */
    private skipTest(testIndex: number, runState: TestRunState) {
        if (testIndex !== -1) {
            this.testRun.skipped(this.testItems[testIndex]);
            this.testItems.splice(testIndex, 1);
        }
        runState.failedTest = undefined;
        runState.currentTestItem = undefined;
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

    setTestsEnqueued() {
        for (const test of this.testItems) {
            this.testRun.enqueued(test);
        }
    }
}

/**
 * Store state of current test run output parse
 */
class TestRunState {
    public currentTestItem?: vscode.TestItem;
    public suiteStack: string[] = [];
    public failedTest?: {
        testIndex: number;
        message: string;
        file: string;
        lineNumber: number;
        complete: boolean;
    };
}
