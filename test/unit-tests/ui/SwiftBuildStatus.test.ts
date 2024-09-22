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
import configuration from "../../../src/configuration";
import * as vscode from "vscode";
import {
    mockGlobalValue,
    mockGlobalObject,
    mockObject,
    MockedObject,
    mockGlobalEvent,
    instance,
    mockFn,
} from "../MockUtils";
import { SwiftExecution } from "../../../src/tasks/SwiftExecution";
import { TestSwiftProcess } from "../../fixtures";
import { StatusItem } from "../../../src/ui/StatusItem";
import { SwiftBuildStatus } from "../../../src/ui/SwiftBuildStatus";

suite("SwiftBuildStatus Unit Test Suite", async function () {
    const windowMock = mockGlobalObject(vscode, "window");
    const didStartTaskMock = mockGlobalEvent(vscode.tasks, "onDidStartTask");
    const configurationMock = mockGlobalValue(configuration, "showBuildStatus");

    let mockedProgress: MockedObject<
        vscode.Progress<{
            message?: string;
            increment?: number;
        }>
    >;
    let mockedStatusItem: MockedObject<StatusItem>;
    let task: MockedObject<vscode.Task>;
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
        windowMock.withProgress.callsFake(async (options, task) => {
            const cts = new vscode.CancellationTokenSource();
            await task(mockedProgress, cts.token);
        });
        mockedStatusItem = mockObject<StatusItem>({
            showStatusWhileRunning: mockFn(s =>
                s.callsFake(async (task, process) => {
                    await process();
                })
            ),
            start: mockFn(),
            update: mockFn(),
            end: mockFn(),
            dispose: mockFn(),
        });
        testSwiftProcess = new TestSwiftProcess("swift", ["build"]);
        swiftExecution = new SwiftExecution(
            testSwiftProcess.command,
            testSwiftProcess.args,
            {},
            testSwiftProcess
        );
        task = new vscode.Task(
            { type: "swift" },
            vscode.TaskScope.Global,
            "My Task",
            "swift",
            swiftExecution
        );
        mockedTaskExecution = mockObject<vscode.TaskExecution>({
            task: task,
            terminate: mockFn(),
        });
    });

    test("Never show status", async () => {
        configurationMock.setValue("never");

        new SwiftBuildStatus(instance(mockedStatusItem));
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(mockedStatusItem.showStatusWhileRunning).to.not.have.been.called;
        expect(windowMock.withProgress).to.not.have.been.called;
    });

    test("Ignore non-swift task", async () => {
        task.execution = new vscode.ShellExecution("swift");
        configurationMock.setValue("swiftStatus");

        new SwiftBuildStatus(instance(mockedStatusItem));
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(mockedStatusItem.showStatusWhileRunning).to.not.have.been.called;
        expect(windowMock.withProgress).to.not.have.been.called;
    });

    test("Show swift status", async () => {
        configurationMock.setValue("swiftStatus");

        new SwiftBuildStatus(instance(mockedStatusItem));
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(mockedStatusItem.showStatusWhileRunning).to.have.been.calledWith(
            mockedTaskExecution.task
        );
        expect(windowMock.withProgress).to.not.have.been.called;
    });

    test("Show status bar progress", async () => {
        configurationMock.setValue("progress");

        new SwiftBuildStatus(instance(mockedStatusItem));
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.have.been.calledWith({
            location: vscode.ProgressLocation.Window,
        });
        expect(mockedStatusItem.showStatusWhileRunning).to.not.have.been.called;
    });

    test("Show notification progress", async () => {
        configurationMock.setValue("notification");

        new SwiftBuildStatus(instance(mockedStatusItem));
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.have.been.calledWith({
            location: vscode.ProgressLocation.Notification,
        });
        expect(mockedStatusItem.showStatusWhileRunning).to.not.have.been.called;
    });

    test("Update fetching", async () => {
        // Setup progress
        configurationMock.setValue("progress");
        new SwiftBuildStatus(instance(mockedStatusItem));
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        // Setup swiftStatus
        configurationMock.setValue("swiftStatus");
        new SwiftBuildStatus(instance(mockedStatusItem));
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "Fetched https://github.com/apple/example-package-figlet from cache (0.43s)\n" +
                "Fetching https://github.com/apple/swift-testing.git from cache\n" +
                "Fetched https://github.com/apple/swift-testing.git from cache (0.77s)\n"
        );

        const expected = "My Task fetching dependencies";
        expect(mockedProgress.report).to.have.been.calledWith({ message: expected });
        expect(mockedStatusItem.update).to.have.been.calledWith(mockedTaskExecution.task, expected);
    });

    test("Update build progress", async () => {
        // Setup progress
        configurationMock.setValue("progress");
        new SwiftBuildStatus(instance(mockedStatusItem));
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        // Setup swiftStatus
        configurationMock.setValue("swiftStatus");
        new SwiftBuildStatus(instance(mockedStatusItem));
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "[6/7] Building main.swift\n" +
                "[7/7] Applying MyCLI\n"
        );

        const expected = "My Task [7/7]";
        expect(mockedProgress.report).to.have.been.calledWith({ message: expected });
        expect(mockedStatusItem.update).to.have.been.calledWith(mockedTaskExecution.task, expected);

        // Ignore old stuff
        expect(mockedProgress.report).to.not.have.been.calledWith({
            message: "My Task fetching dependencies",
        });
        expect(mockedProgress.report).to.not.have.been.calledWith({ message: "My Task [6/7]" });
    });

    test("Build complete", async () => {
        // Setup progress
        configurationMock.setValue("progress");
        new SwiftBuildStatus(instance(mockedStatusItem));
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        // Setup swiftStatus
        configurationMock.setValue("swiftStatus");
        new SwiftBuildStatus(instance(mockedStatusItem));
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "[6/7] Building main.swift\n" +
                "[7/7] Applying MyCLI\n" +
                "Build complete!"
        );

        // Report nothing
        expect(mockedProgress.report).to.not.have.been.called;
        expect(mockedStatusItem.update).to.not.have.been.called;
    });
});
