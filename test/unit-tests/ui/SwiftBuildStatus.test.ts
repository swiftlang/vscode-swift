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
import { StatusItem } from "@src/ui/StatusItem";
import { SwiftBuildStatus } from "@src/ui/SwiftBuildStatus";

import {
    MockedObject,
    instance,
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
    let statusItem: MockedObject<StatusItem>;
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
        statusItem = mockObject<StatusItem>({
            showStatusWhileRunning: mockFn(s => s.callsFake(async (_task, process) => process())),
            update: mockFn(),
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

        buildStatus = new SwiftBuildStatus(instance(statusItem));
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.not.have.been.called;
        expect(statusItem.showStatusWhileRunning).to.not.have.been.called;
    });

    test("Ignore non-swift task", async () => {
        mockedTask.definition = { type: "shell" };
        configurationMock.setValue("swiftStatus");

        buildStatus = new SwiftBuildStatus(instance(statusItem));
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.not.have.been.called;
        expect(statusItem.showStatusWhileRunning).to.not.have.been.called;
    });

    test("Show swift status routes through StatusItem", async () => {
        configurationMock.setValue("swiftStatus");

        buildStatus = new SwiftBuildStatus(instance(statusItem));
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(statusItem.showStatusWhileRunning).to.have.been.calledOnce;
        expect(windowMock.withProgress).to.not.have.been.called;
    });

    test("Show progress uses withProgress at Window location", async () => {
        configurationMock.setValue("progress");

        buildStatus = new SwiftBuildStatus(instance(statusItem));
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.have.been.calledWith({
            location: vscode.ProgressLocation.Window,
        });
        expect(statusItem.showStatusWhileRunning).to.not.have.been.called;
    });

    test("Show notification uses withProgress at Notification location", async () => {
        configurationMock.setValue("notification");

        buildStatus = new SwiftBuildStatus(instance(statusItem));
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.have.been.calledWith({
            location: vscode.ProgressLocation.Notification,
        });
        expect(statusItem.showStatusWhileRunning).to.not.have.been.called;
    });

    test("Update fetching", async () => {
        configurationMock.setValue("swiftStatus");
        buildStatus = new SwiftBuildStatus(instance(statusItem));
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "Fetched https://github.com/apple/example-package-figlet from cache (0.43s)\n" +
                "Fetching https://github.com/apple/swift-testing.git from cache\n" +
                "Fetched https://github.com/apple/swift-testing.git from cache (0.77s)\n"
        );

        expect(statusItem.update).to.have.been.calledWith(
            mockedTask,
            "My Task: Fetching Dependencies"
        );
    });

    test("Only updates build progress once when shown in the status bar", async () => {
        configurationMock.setValue("swiftStatus");
        buildStatus = new SwiftBuildStatus(instance(statusItem));
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        // Ignore the initial "Preparing..." update; we only care about the build-progress phase.
        statusItem.update.resetHistory();

        testSwiftProcess.write("[1/7] Compiling A.swift\n");
        testSwiftProcess.write("[4/7] Compiling B.swift\n");
        testSwiftProcess.write("[7/7] Applying MyCLI\n");

        expect(statusItem.update).to.have.been.calledOnceWithExactly(mockedTask, "My Task");
    });

    test("Notification mode reports incremental progress across multiple writes", async () => {
        configurationMock.setValue("notification");
        buildStatus = new SwiftBuildStatus(instance(statusItem));
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
        configurationMock.setValue("notification");
        buildStatus = new SwiftBuildStatus(instance(statusItem));
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
        configurationMock.setValue("swiftStatus");
        buildStatus = new SwiftBuildStatus(instance(statusItem));
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(statusItem.update).to.have.been.calledWith(mockedTask, "My Task: Preparing...");
    });

    test("Build complete", async () => {
        configurationMock.setValue("swiftStatus");
        buildStatus = new SwiftBuildStatus(instance(statusItem));
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "[6/7] Building main.swift\n" +
                "[7/7] Applying MyCLI\n" +
                "Build complete!"
        );

        // Report only the preparing message
        expect(statusItem.update).to.have.been.calledWith(mockedTask, "My Task: Preparing...");
    });

    test("Parses progress with spaces around the slash (newer toolchains)", async () => {
        // Assert via a withProgress location, which still reports the counter.
        configurationMock.setValue("notification");
        buildStatus = new SwiftBuildStatus(instance(statusItem));
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        // swift-build emits a U+2009 THIN SPACE on either side of the slash
        // via activityMessageFractionString; SwiftPM forwards it verbatim.
        testSwiftProcess.write("[191 / 195] SimpleLibraryTests-product\n");
        expect(mockedProgress.report).to.have.been.calledWith({
            message: "My Task: [191/195]",
            increment: 97,
        });
    });

    test("Reports Planning status during planning phase, then switches to progress", async () => {
        configurationMock.setValue("swiftStatus");
        buildStatus = new SwiftBuildStatus(instance(statusItem));
        await didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write("[Planning 123 / 124]\n[Planning deferred tasks]\n");
        expect(statusItem.update).to.have.been.calledWith(mockedTask, "My Task: Planning...");

        testSwiftProcess.write("[36 / 75]\n");
        expect(statusItem.update).to.have.been.calledWith(mockedTask, "My Task");
    });
});
