//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as asyncfs from "fs/promises";
import * as path from "path";
import { createTestConfiguration, createDarwinTestConfiguration } from "../debugger/launch";
import { FolderContext } from "../FolderContext";
import { execFileStreamOutput } from "../utilities/utilities";
import { createBuildAllTask, executeTaskAndWait } from "../SwiftTaskProvider";
import * as Stream from "stream";

/** Class used to run tests */
export class TestRunner {
    private testRun: vscode.TestRun;
    private testItems: vscode.TestItem[];

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
        this.testItems = this.createTestList();
    }

    /**
     * Setup debug and run test profiles
     * @param controller Test controller
     * @param folderContext Folder tests are running in
     */
    static setupProfiles(controller: vscode.TestController, folderContext: FolderContext) {
        // Add non-debug profile
        controller.createRunProfile(
            "Run",
            vscode.TestRunProfileKind.Run,
            async (request, token) => {
                const runner = new TestRunner(request, folderContext, controller);
                await runner.runHandler(false, token);
            }
        );
        // Add debug profile
        controller.createRunProfile(
            "Debug",
            vscode.TestRunProfileKind.Debug,
            async (request, token) => {
                const runner = new TestRunner(request, folderContext, controller);
                await runner.runHandler(true, token);
            }
        );
    }

    /** Construct test item list from TestRequest */
    createTestList(): vscode.TestItem[] {
        const queue: vscode.TestItem[] = [];

        // Loop through all included tests, or all known tests, and add them to our queue
        if (this.request.include) {
            this.request.include.forEach(test => queue.push(test));
        } else {
            this.controller.items.forEach(test => queue.push(test));
        }

        // create test list
        const list: vscode.TestItem[] = [];
        while (queue.length > 0) {
            const test = queue.pop()!;

            // Skip tests the user asked to exclude
            if (this.request.exclude?.includes(test)) {
                continue;
            }

            if (test.children.size > 0) {
                test.children.forEach(test => queue.push(test));
                continue;
            }
            list.push(test);
        }
        return list;
    }

    /**
     * Test run handler. Run a series of tests and extracts the results from the output
     * @param shouldDebug Should we run the debugger
     * @param token Cancellation token
     * @returns When complete
     */
    async runHandler(shouldDebug: boolean, token: vscode.CancellationToken) {
        if (token.isCancellationRequested) {
            return;
        }

        try {
            if (shouldDebug) {
                await this.debugSession(token);
            } else {
                await this.runSession(token);
            }
        } catch (error) {
            const reason = error as string;
            if (reason) {
                this.testRun.appendOutput(reason.toString());
            }
            console.log(error);
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
        const testList = this.testItems.map(item => item.id).join(",");

        if (process.platform === "darwin") {
            // if debugging on macOS need to create a custom launch configuration so we can set the
            // the system architecture
            if (debugging && outputFile) {
                const testBuildConfig = createDarwinTestConfiguration(
                    this.folderContext,
                    `-XCTest ${testList}`,
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

                testBuildConfig.args = ["-XCTest", testList, ...testBuildConfig.args];
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

            testBuildConfig.args = [testList];
            // send stdout to testOutputPath. Cannot send both stdout and stderr to same file as it
            // doesn't come out in the correct order
            testBuildConfig.stdio = [null, outputFile, null];
            return testBuildConfig;
        }
    }

    /** Run test session without attaching to a debugger */
    async runSession(token: vscode.CancellationToken) {
        // create launch config for testing
        const testBuildConfig = this.createLaunchConfigurationForTesting(false);
        if (testBuildConfig === null) {
            return;
        }

        // run associated build task
        const task = createBuildAllTask(this.folderContext);
        await executeTaskAndWait(task);

        // Use WriteStream to log results
        const writeStream = new Stream.Writable();
        writeStream._write = (chunk, encoding, next) => {
            const text = chunk.toString("utf8");
            this.testRun.appendOutput(text.replace(/\n/g, "\r\n"));
            if (process.platform === "darwin") {
                this.parseResultDarwin(text);
            } else {
                this.parseResultNonDarwin(text);
            }
            next();
        };
        writeStream.on("close", () => {
            writeStream.end();
        });

        let stdout: Stream.Writable | null = null;
        let stderr: Stream.Writable | null = null;
        if (process.platform === "darwin") {
            stderr = writeStream;
        } else {
            stdout = writeStream;
        }

        if (token.isCancellationRequested) {
            writeStream.end();
            return;
        }

        this.testRun.appendOutput(`> Test run started at ${new Date().toLocaleString()} <\r\n\r\n`);
        // show test results pane
        vscode.commands.executeCommand("testing.showMostRecentOutput");

        await execFileStreamOutput(
            testBuildConfig.program,
            testBuildConfig.args,
            stdout,
            stderr,
            token,
            {
                cwd: testBuildConfig.cwd,
            }
        );
    }

    /** Run test session inside debugger */
    async debugSession(token: vscode.CancellationToken) {
        const testOutputPath = this.folderContext.workspaceContext.tempFolder.filename(
            "TestOutput",
            "txt"
        );
        // create launch config for testing
        const testBuildConfig = this.createLaunchConfigurationForTesting(true, testOutputPath);
        if (testBuildConfig === null) {
            return;
        }

        const subscriptions: vscode.Disposable[] = [];
        // add cancelation
        const startSession = vscode.debug.onDidStartDebugSession(session => {
            const cancellation = token.onCancellationRequested(() => {
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
                                try {
                                    if (!token.isCancellationRequested) {
                                        const debugOutput = await asyncfs.readFile(testOutputPath, {
                                            encoding: "utf8",
                                        });
                                        this.testRun.appendOutput(
                                            debugOutput.replace(/\n/g, "\r\n")
                                        );
                                        if (process.platform === "darwin") {
                                            this.parseResultDarwin(debugOutput);
                                        } else {
                                            this.parseResultNonDarwin(debugOutput);
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
     * Parse results from `swift test` and update tests accordingly for Darwin platforms
     * @param output Output from `swift test`
     */
    private parseResultDarwin(output: string) {
        const lines = output.split("\n").map(item => item.trim());

        for (const line of lines) {
            // Regex "Test Case '-[<test target> <class.function>]' passed"
            const passedMatch = /^Test Case '-\[(\S+)\s(.*)\]' passed/.exec(line);
            if (passedMatch) {
                const testId = `${passedMatch[1]}/${passedMatch[2]}`;
                const passedTestIndex = this.testItems.findIndex(item => item.id === testId);
                if (passedTestIndex !== -1) {
                    this.testRun.passed(this.testItems[passedTestIndex]);
                    this.testItems.splice(passedTestIndex, 1);
                }
                continue;
            }
            // Regex "<path/to/test>:<line number>: error: -[<test target> <class.function>] : <error>"
            const failedMatch = /^(.+):(\d+):\serror:\s-\[(\S+)\s(.*)\] : (.*)$/.exec(line);
            if (failedMatch) {
                const testId = `${failedMatch[3]}/${failedMatch[4]}`;
                const failedTestIndex = this.testItems.findIndex(item => item.id === testId);
                if (failedTestIndex !== -1) {
                    const message = new vscode.TestMessage(failedMatch[5]);
                    message.location = new vscode.Location(
                        vscode.Uri.file(failedMatch[1]),
                        new vscode.Position(parseInt(failedMatch[2]) - 1, 0)
                    );
                    this.testRun.failed(this.testItems[failedTestIndex], message);
                    this.testItems.splice(failedTestIndex, 1);
                }
                continue;
            }
            // Regex "<path/to/test>:<line number>: -[<test target> <class.function>] : Test skipped"
            const skippedMatch = /^(.+):(\d+):\s-\[(\S+)\s(.*)\] : Test skipped/.exec(line);
            if (skippedMatch) {
                const testId = `${skippedMatch[3]}/${skippedMatch[4]}`;
                const skippedTestIndex = this.testItems.findIndex(item => item.id === testId);
                if (skippedTestIndex !== -1) {
                    this.testRun.skipped(this.testItems[skippedTestIndex]);
                    this.testItems.splice(skippedTestIndex, 1);
                }
                continue;
            }
        }
    }

    /**
     * Parse results from `swift test` and update tests accordingly for non Darwin
     * platforms eg Linux and Windows
     * @param output Output from `swift test`
     */
    private parseResultNonDarwin(output: string) {
        const lines = output.split("\n").map(item => item.trim());

        // Non-Darwin test output does not include the test target name. The only way to find out
        // the target for a test is when it fails and returns a file name. If we find failed tests
        // first and then remove them from the list we cannot set them to passed by mistake.
        // We extract the file name from the error and use that to check whether the file belongs
        // to the target associated with the TestItem. This does not work 100% as the error could
        // occur in another target, so we revert to just searching for class and function name if
        // the above method is unsuccessful.
        for (const line of lines) {
            // Regex "<path/to/test>:<line number>: error: <class>.<function> : <error>"
            const failedMatch = /^(.+):(\d+):\serror:\s*(.*)\.(.*) : (.*)/.exec(line);
            if (failedMatch) {
                const testName = `${failedMatch[3]}/${failedMatch[4]}`;
                let failedTestIndex = this.testItems.findIndex(item =>
                    this.isTestWithFilenameInTarget(testName, failedMatch[1], item)
                );
                // didn't find failed test so just search using class name and test function name
                if (failedTestIndex === -1) {
                    failedTestIndex = this.testItems.findIndex(item => item.id.endsWith(testName));
                }
                if (failedTestIndex !== -1) {
                    const message = new vscode.TestMessage(failedMatch[5]);
                    message.location = new vscode.Location(
                        vscode.Uri.file(failedMatch[1]),
                        new vscode.Position(parseInt(failedMatch[2]), 0)
                    );
                    this.testRun.failed(this.testItems[failedTestIndex], message);
                    // remove from test item list as its status has been set
                    this.testItems.splice(failedTestIndex, 1);
                }
                continue;
            }
            // Regex "<path/to/test>:<line number>: <class>.<function> : Test skipped:"
            const skippedMatch = /^(.+):(\d+):\s*(.*)\.(.*) : Test skipped:/.exec(line);
            if (skippedMatch) {
                const testName = `${skippedMatch[3]}/${skippedMatch[4]}`;
                let skippedTestIndex = this.testItems.findIndex(item =>
                    this.isTestWithFilenameInTarget(testName, skippedMatch[1], item)
                );
                if (skippedTestIndex === -1) {
                    skippedTestIndex = this.testItems.findIndex(item => item.id.endsWith(testName));
                }
                if (skippedTestIndex !== -1) {
                    this.testRun.skipped(this.testItems[skippedTestIndex]);
                    // remove from test item list as its status has been set
                    this.testItems.splice(skippedTestIndex, 1);
                }
                continue;
            }
        }

        for (const line of lines) {
            // Regex "Test Case '<class>.<function>' passed"
            const passedMatch = /^Test Case '(.*)\.(.*)' passed/.exec(line);
            if (passedMatch) {
                const testName = `${passedMatch[1]}/${passedMatch[2]}`;
                const passedTestIndex = this.testItems.findIndex(item =>
                    item.id.endsWith(testName)
                );
                if (passedTestIndex !== -1) {
                    this.testRun.passed(this.testItems[passedTestIndex]);
                    // remove from test item list as its status has been set
                    this.testItems.splice(passedTestIndex, 1);
                }
                continue;
            }
        }
    }

    /**
     * Linux test output does not include the target name. So I have to work out which target
     * the test is in via the test name and if it failed the filename from the error. In theory
     * If a test fails the filename for where it failed should indicate which target it is in.
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
