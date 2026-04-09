//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { expect } from "chai";
import * as vscode from "vscode";

import configuration from "@src/configuration";
import { SwiftExecution } from "@src/tasks/SwiftExecution";
import { SwiftBuildStatus } from "@src/ui/SwiftBuildStatus";

import {
    MockedObject,
    mockFn,
    mockGlobalEvent,
    mockGlobalObject,
    mockGlobalValue,
    mockObject,
} from "../../MockUtils";
import { TestSwiftProcess } from "../../fixtures";

suite("SwiftBuildStatus Unit Test Suite", function () {
    const windowMock = mockGlobalObject(vscode, "window");
    const didStartTaskMock = mockGlobalEvent(vscode.tasks, "onDidStartTask");
    const configurationMock = mockGlobalValue(configuration, "showBuildStatus");

    let buildStatus: SwiftBuildStatus;
    let mockedProgress: MockedObject<
        vscode.Progress<{
            message?: string;
            increment?: number;
        }>
    >;
    let mockedTask: MockedObject<vscode.Task>;
    let swiftExecution: SwiftExecution;
    let testSwiftProcess: TestSwiftProcess;
    let mockedTaskExecution: MockedObject<vscode.TaskExecution>;

    setup(() => {
        mockedProgress = mockObject<
            vscode.Progress<{
                message?: string;
                increment?: number;
            }>
        >({
            report: mockFn(),
        });
        windowMock.withProgress.callsFake(async (_options, task) => {
            const cts = new vscode.CancellationTokenSource();
            await task(mockedProgress, cts.token);
        });
        testSwiftProcess = new TestSwiftProcess("swift", ["build"]);
        swiftExecution = new SwiftExecution(
            testSwiftProcess.command,
            testSwiftProcess.args,
            {},
            testSwiftProcess
        );
        mockedTask = new vscode.Task(
            { type: "swift" },
            vscode.TaskScope.Global,
            "My Task",
            "swift",
            swiftExecution
        );
        mockedTaskExecution = mockObject<vscode.TaskExecution>({
            task: mockedTask,
            terminate: mockFn(),
        });
    });

    teardown(() => {
        buildStatus.dispose();
    });

    test("Never show status", async () => {
        configurationMock.setValue("never");

        buildStatus = new SwiftBuildStatus();
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.not.have.been.called;
    });

    test("Ignore non-swift task", async () => {
        mockedTask.definition = { type: "shell" };
        configurationMock.setValue("swiftStatus");

        buildStatus = new SwiftBuildStatus();
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.not.have.been.called;
    });

    test("Show swift status", async () => {
        configurationMock.setValue("swiftStatus");

        buildStatus = new SwiftBuildStatus();
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.have.been.calledWith({
            location: vscode.ProgressLocation.Window,
        });
    });

    test("Show status bar progress", async () => {
        configurationMock.setValue("progress");

        buildStatus = new SwiftBuildStatus();
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.have.been.calledWith({
            location: vscode.ProgressLocation.Window,
        });
    });

    test("Show notification progress", async () => {
        configurationMock.setValue("notification");

        buildStatus = new SwiftBuildStatus();
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.have.been.calledWith({
            location: vscode.ProgressLocation.Notification,
        });
    });

    test("Update fetching", async () => {
        configurationMock.setValue("progress");
        buildStatus = new SwiftBuildStatus();
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "Fetched https://github.com/apple/example-package-figlet from cache (0.43s)\n" +
                "Fetching https://github.com/apple/swift-testing.git from cache\n" +
                "Fetched https://github.com/apple/swift-testing.git from cache (0.77s)\n"
        );

        expect(mockedProgress.report).to.have.been.calledWith({
            message: "My Task: Fetching Dependencies",
        });
    });

    test("Update build progress", async () => {
        configurationMock.setValue("progress");
        buildStatus = new SwiftBuildStatus();
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "[6/7] Building main.swift\n" +
                "[7/7] Applying MyCLI\n"
        );

        const expected = "My Task: [7/7]";
        expect(mockedProgress.report).to.have.been.calledWith({
            message: expected,
            increment: 100,
        });

        // Ignore old stuff
        expect(mockedProgress.report).to.not.have.been.calledWith({
            message: "My Task: Fetching Dependencies",
        });
        expect(mockedProgress.report).to.not.have.been.calledWith({ message: "My Task: [6/7]" });
    });

    test("Reports incremental progress across multiple writes", async () => {
        configurationMock.setValue("progress");
        buildStatus = new SwiftBuildStatus();
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write("[1/4] Compiling A.swift\n");
        expect(mockedProgress.report).to.have.been.calledWith({
            message: "My Task: [1/4]",
            increment: 25,
        });

        testSwiftProcess.write("[3/4] Compiling C.swift\n");
        expect(mockedProgress.report).to.have.been.calledWith({
            message: "My Task: [3/4]",
            increment: 50,
        });

        testSwiftProcess.write("[4/4] Applying MyCLI\n");
        expect(mockedProgress.report).to.have.been.calledWith({
            message: "My Task: [4/4]",
            increment: 25,
        });
    });

    test("Reports zero increment when total increases and progress goes backwards", async () => {
        configurationMock.setValue("progress");
        buildStatus = new SwiftBuildStatus();
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        // [5/10] = 50%
        testSwiftProcess.write("[5/10] Compiling\n");
        expect(mockedProgress.report).to.have.been.calledWith({
            message: "My Task: [5/10]",
            increment: 50,
        });

        // New targets discovered: [5/20] = 25%, a backwards step of -25%.
        // Reported increment should be 0, not negative.
        testSwiftProcess.write("[5/20] Compiling\n");
        expect(mockedProgress.report).to.have.been.calledWith({
            message: "My Task: [5/20]",
            increment: 0,
        });

        // [10/20] = 50%, which matches the last reported percentage.
        // Debt of 25 absorbs this entire +25 increment, so reported is still 0.
        testSwiftProcess.write("[10/20] Compiling\n");
        expect(mockedProgress.report).to.have.been.calledWith({
            message: "My Task: [10/20]",
            increment: 0,
        });

        // [15/20] = 75%, a +25 gain. Debt is fully repaid, so reported increment resumes.
        testSwiftProcess.write("[15/20] Compiling\n");
        expect(mockedProgress.report).to.have.been.calledWith({
            message: "My Task: [15/20]",
            increment: 25,
        });
    });

    test("Preparing phase reports no increment", async () => {
        configurationMock.setValue("progress");
        buildStatus = new SwiftBuildStatus();
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(mockedProgress.report).to.have.been.calledWith({
            message: "My Task: Preparing...",
        });
    });

    test("Build complete", async () => {
        configurationMock.setValue("progress");
        buildStatus = new SwiftBuildStatus();
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "[6/7] Building main.swift\n" +
                "[7/7] Applying MyCLI\n" +
                "Build complete!"
        );

        // Report only the preparing message
        expect(mockedProgress.report).to.have.been.calledWith({ message: "My Task: Preparing..." });
    });
});
