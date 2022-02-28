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
import * as fs from "fs/promises";
import * as path from "path";
import { createTestConfiguration } from "../debugger/launch";
import { FolderContext } from "../FolderContext";

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
     * @param request The test run request, includes list of tests to execute
     * @param token Cancellation token
     * @returns When complete
     */
    async runHandler(shouldDebug: boolean, token: vscode.CancellationToken) {
        if (token.isCancellationRequested) {
            return;
        }

        // setup test output file
        const testResultFile = "testOutput.txt";
        const testOutputPath = path.join(
            this.folderContext.workspaceContext.tempFolder.path,
            testResultFile
        );
        try {
            await fs.rm(testOutputPath);
        } catch {
            // ignore
        }

        // create launch config for testing
        const testBuildConfig = await createTestConfiguration(this.folderContext);
        if (testBuildConfig === null) {
            return;
        }
        this.editLaunchConfigurationForTesting(testBuildConfig, testOutputPath);

        vscode.debug
            .startDebugging(this.folderContext.workspaceFolder, testBuildConfig, {
                noDebug: !shouldDebug,
            })
            .then(
                started => {
                    if (started) {
                        vscode.debug.onDidTerminateDebugSession(async () => {
                            try {
                                const debugOutput = await fs.readFile(testOutputPath, {
                                    encoding: "utf8",
                                });
                                this.testRun.appendOutput(debugOutput.replace(/\n/g, "\r\n"));
                                if (process.platform === "darwin") {
                                    this.parseResultDarwin(debugOutput);
                                } else {
                                    this.parseResultNonDarwin(debugOutput);
                                }
                                await fs.rm(testOutputPath);
                            } catch {
                                // ignore error
                            }
                            this.testRun.end();
                        });
                    } else {
                        this.testRun.end();
                    }
                },
                reason => {
                    this.testRun.appendOutput(reason);
                    this.testRun.end();
                }
            );
    }

    /**
     *
     * @param config Launch configuration
     * @param outputFile Debug output file
     * @returns
     */
    private editLaunchConfigurationForTesting(
        config: vscode.DebugConfiguration,
        outputFile: string
    ) {
        const testList = this.testItems.map(item => item.id).join(",");

        if (process.platform === "darwin") {
            config.args = ["-XCTest", testList, ...config.args];
            // send stderr to testOutputPath. Cannot send both stdout and stderr to same file as it
            // doesn't come out in the correct order
            config.stdio = [null, null, outputFile];
        } else {
            config.args = [testList];
            // send stdout to testOutputPath. Cannot send both stdout and stderr to same file as it
            // doesn't come out in the correct order
            config.stdio = [null, outputFile, null];
        }
    }

    /**
     * Parse results from `swift test` and update tests accordingly for Darwin platforms
     * @param output Output from `swift test`
     * @param testRun Associated test run
     * @param tests List of test items being tested
     */
    private parseResultDarwin(output: string) {
        const lines = output.split("\n").map(item => item.trim());

        for (const line of lines) {
            const passedMatch = /Test Case '-\[(\S+)\s(.*)\]' passed/.exec(line);
            if (passedMatch) {
                const testId = `${passedMatch[1]}/${passedMatch[2]}`;
                const passedTestIndex = this.testItems.findIndex(item => item.id === testId);
                if (passedTestIndex !== -1) {
                    this.testRun.passed(this.testItems[passedTestIndex]);
                    this.testItems.splice(passedTestIndex, 1);
                }
                continue;
            }
            const failedMatch = /^(.+):(\d+):\serror:\s-\[(\S+)\s(.*)\] : (.*)$/.exec(line);
            if (failedMatch) {
                const testId = `${failedMatch[3]}/${failedMatch[4]}`;
                const failedTestIndex = this.testItems.findIndex(item => item.id === testId);
                if (failedTestIndex !== -1) {
                    const message = new vscode.TestMessage(failedMatch[5]);
                    message.location = new vscode.Location(
                        vscode.Uri.file(failedMatch[1]),
                        new vscode.Position(parseInt(failedMatch[2]), 0)
                    );
                    this.testRun.failed(this.testItems[failedTestIndex], message);
                    this.testItems.splice(failedTestIndex, 1);
                }
                continue;
            }
        }
    }

    /**
     * Parse results from `swift test` and update tests accordingly for non Darwin
     * platforms eg Linux and Windows
     * @param output Output from `swift test`
     * @param testRun Associated test run
     * @param tests List of test items being tested
     */
    private parseResultNonDarwin(output: string) {
        const lines = output.split("\n").map(item => item.trim());

        for (const line of lines) {
            const passedMatch = /Test Case '(.*)\.(.*)' passed/.exec(line);
            if (passedMatch) {
                const testName = `${passedMatch[1]}/${passedMatch[2]}`;
                const passedTestIndex = this.testItems.findIndex(item =>
                    item.id.endsWith(testName)
                );
                if (passedTestIndex !== -1) {
                    this.testRun.passed(this.testItems[passedTestIndex]);
                    this.testItems.splice(passedTestIndex, 1);
                }
                continue;
            }
            const failedMatch = /^(.+):(\d+):\serror:\s*(.*)\.(.*) : (.*)/.exec(line);
            if (failedMatch) {
                const testName = `${failedMatch[3]}/${failedMatch[4]}`;
                const failedTestIndex = this.testItems.findIndex(item =>
                    item.id.endsWith(testName)
                );
                if (failedTestIndex !== -1) {
                    const message = new vscode.TestMessage(failedMatch[5]);
                    message.location = new vscode.Location(
                        vscode.Uri.file(failedMatch[1]),
                        new vscode.Position(parseInt(failedMatch[2]), 0)
                    );
                    this.testRun.failed(this.testItems[failedTestIndex], message);
                    this.testItems.splice(failedTestIndex, 1);
                }
                continue;
            }
        }
    }
}
