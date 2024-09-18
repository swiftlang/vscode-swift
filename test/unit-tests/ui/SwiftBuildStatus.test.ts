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
    mockValue,
    mockNamespace,
    mockObject,
    MockedObject,
    fn,
    mockEventEmitter,
    MockedFunction,
} from "../MockUtils2";
import { SwiftExecution } from "../../../src/tasks/SwiftExecution";
import { TestSwiftProcess } from "../../fixtures";
import { StatusItem } from "../../../src/ui/StatusItem";
import { SwiftBuildStatus } from "../../../src/ui/SwiftBuildStatus";

async function waitForReturnedPromises(
    mockedFn: MockedFunction<(...args: any) => Thenable<any>>
): Promise<void> {
    for (const promise in mockedFn.returnValues) {
        await promise;
    }
}

suite("SwiftBuildStatus Unit Test Suite", async function () {
    const windowMock = mockNamespace(vscode, "window");
    const didStartTaskMock = mockEventEmitter(vscode.tasks, "onDidStartTask");
    const configurationMock = mockValue(configuration, "showBuildStatus");

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
            report: fn(),
        });
        windowMock.withProgress.callsFake(async (options, task) => {
            const cts = new vscode.CancellationTokenSource();
            await task(mockedProgress, cts.token);
        });
        mockedStatusItem = mockObject<StatusItem>({
            showStatusWhileRunning: fn(),
            start: fn(),
            update: fn(),
            end: fn(),
            dispose: fn(),
        });
        mockedStatusItem.showStatusWhileRunning.callsFake(async (task, process) => {
            await process();
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
            terminate() {},
        });
    });

    test("Never show status", async () => {
        configurationMock.setValue("never");

        new SwiftBuildStatus(mockedStatusItem);
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(mockedStatusItem.showStatusWhileRunning).to.not.have.been.called;
        expect(windowMock.withProgress).to.not.have.been.called;
    });

    test("Ignore non-swift task", async () => {
        task.execution = new vscode.ShellExecution("swift");
        configurationMock.setValue("swiftStatus");

        new SwiftBuildStatus(mockedStatusItem);
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(mockedStatusItem.showStatusWhileRunning).to.not.have.been.called;
        expect(windowMock.withProgress).to.not.have.been.called;
    });

    test("Show swift status", async () => {
        configurationMock.setValue("swiftStatus");

        new SwiftBuildStatus(mockedStatusItem);
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(mockedStatusItem.showStatusWhileRunning).to.have.been.calledWith(
            mockedTaskExecution.task
        );
        expect(windowMock.withProgress).to.not.have.been.called;
    });

    test("Show status bar progress", async () => {
        configurationMock.setValue("progress");

        new SwiftBuildStatus(mockedStatusItem);
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.have.been.calledWith({
            location: vscode.ProgressLocation.Window,
        });
        expect(mockedStatusItem.showStatusWhileRunning).to.not.have.been.called;
    });

    test("Show notification progress", async () => {
        configurationMock.setValue("notification");

        new SwiftBuildStatus(mockedStatusItem);
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        expect(windowMock.withProgress).to.have.been.calledWith({
            location: vscode.ProgressLocation.Notification,
        });
        expect(mockedStatusItem.showStatusWhileRunning).to.not.have.been.called;
    });

    test("Update fetching", async () => {
        // Setup progress
        configurationMock.setValue("progress");
        new SwiftBuildStatus(mockedStatusItem);
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        // Setup swiftStatus
        configurationMock.setValue("swiftStatus");
        new SwiftBuildStatus(mockedStatusItem);
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "Fetched https://github.com/apple/example-package-figlet from cache (0.43s)\n" +
                "Fetching https://github.com/apple/swift-testing.git from cache\n" +
                "Fetched https://github.com/apple/swift-testing.git from cache (0.77s)\n"
        );

        await waitForReturnedPromises(windowMock.withProgress);
        await waitForReturnedPromises(mockedStatusItem.showStatusWhileRunning);

        const expected = "My Task fetching dependencies";
        expect(mockedProgress.report).to.have.been.calledWith({ message: expected });
        expect(mockedStatusItem.update).to.have.been.calledWith(mockedTaskExecution.task, expected);
    });

    test("Update build progress", async () => {
        // Setup progress
        configurationMock.setValue("progress");
        new SwiftBuildStatus(mockedStatusItem);
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        // Setup swiftStatus
        configurationMock.setValue("swiftStatus");
        new SwiftBuildStatus(mockedStatusItem);
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "[6/7] Building main.swift\n" +
                "[7/7] Applying MyCLI\n"
        );

        await waitForReturnedPromises(windowMock.withProgress);
        await waitForReturnedPromises(mockedStatusItem.showStatusWhileRunning);

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
        new SwiftBuildStatus(mockedStatusItem);
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        // Setup swiftStatus
        configurationMock.setValue("swiftStatus");
        new SwiftBuildStatus(mockedStatusItem);
        didStartTaskMock.fire({ execution: mockedTaskExecution });

        testSwiftProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "[6/7] Building main.swift\n" +
                "[7/7] Applying MyCLI\n" +
                "Build complete!"
        );

        await waitForReturnedPromises(windowMock.withProgress);
        await waitForReturnedPromises(mockedStatusItem.showStatusWhileRunning);

        // Report nothing
        expect(mockedProgress.report).to.not.have.been.called;
        expect(mockedStatusItem.update).to.not.have.been.called;
    });
});
