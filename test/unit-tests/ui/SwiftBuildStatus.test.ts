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
import {
    anyFunction,
    anything,
    capture,
    deepEqual,
    instance,
    mock,
    verify,
    when,
} from "ts-mockito";
import configuration from "../../../src/configuration";
import * as vscode from "vscode";
import { eventListenerMock, mockValue, mockNamespace } from "../MockUtils";
import { SwiftExecution } from "../../../src/tasks/SwiftExecution";
import { TestSwiftProcess } from "../../fixtures";
import { StatusItem } from "../../../src/ui/StatusItem";
import { SwiftBuildStatus } from "../../../src/ui/SwiftBuildStatus";

suite("SwiftBuildStatus Unit Test Suite", async function () {
    const windowMock = mockNamespace(vscode, "window");
    const listenerMock = eventListenerMock(vscode.tasks, "onDidStartTask");
    const configurationMock = mockValue(configuration, "showBuildStatus");

    let mockedStatusItem: StatusItem;
    let mockedTask: vscode.Task;
    let mockedExecution: SwiftExecution;
    let mockedProcess: TestSwiftProcess;
    let mockedTaskExecution: vscode.TaskExecution;

    setup(() => {
        mockedStatusItem = mock(StatusItem);
        mockedTask = mock(vscode.Task);
        mockedProcess = new TestSwiftProcess("swift", ["build"]);
        mockedExecution = new SwiftExecution(
            mockedProcess.command,
            mockedProcess.args,
            {},
            mockedProcess
        );
        when(mockedTask.definition).thenReturn({ type: "swift" });
        when(mockedTask.execution).thenReturn(mockedExecution);
        when(mockedTask.name).thenReturn("My Task");

        // https://github.com/NagRock/ts-mockito/issues/204
        const task = instance(mockedTask);
        Object.setPrototypeOf(task, vscode.Task.prototype);
        mockedTaskExecution = { task, terminate: () => {} };
    });

    test("Never show status", async () => {
        configurationMock.setValue("never");

        new SwiftBuildStatus(instance(mockedStatusItem));
        listenerMock.notifyAll({ execution: mockedTaskExecution });

        verify(
            mockedStatusItem.showStatusWhileRunning(mockedTaskExecution.task, anyFunction())
        ).never();
        verify(windowMock.withProgress(anything(), anyFunction())).never();
    });

    test("Ignore non-swift task", async () => {
        when(mockedTask.execution).thenReturn(new vscode.ShellExecution("swift"));
        configurationMock.setValue("swiftStatus");

        new SwiftBuildStatus(instance(mockedStatusItem));
        listenerMock.notifyAll({ execution: mockedTaskExecution });

        verify(
            mockedStatusItem.showStatusWhileRunning(mockedTaskExecution.task, anyFunction())
        ).never();
        verify(windowMock.withProgress(anything(), anyFunction())).never();
    });

    test("Show swift status", async () => {
        configurationMock.setValue("swiftStatus");

        new SwiftBuildStatus(instance(mockedStatusItem));
        listenerMock.notifyAll({ execution: mockedTaskExecution });

        verify(
            mockedStatusItem.showStatusWhileRunning(mockedTaskExecution.task, anyFunction())
        ).called();
        verify(windowMock.withProgress(anything(), anyFunction())).never();
    });

    test("Show status bar progress", async () => {
        configurationMock.setValue("progress");

        new SwiftBuildStatus(instance(mockedStatusItem));
        listenerMock.notifyAll({ execution: mockedTaskExecution });

        verify(
            windowMock.withProgress(
                deepEqual({ location: vscode.ProgressLocation.Window }),
                anyFunction()
            )
        ).called();
        verify(mockedStatusItem.showStatusWhileRunning(anything(), anyFunction())).never();
    });

    test("Show notification progress", async () => {
        configurationMock.setValue("notification");

        new SwiftBuildStatus(instance(mockedStatusItem));
        listenerMock.notifyAll({ execution: mockedTaskExecution });

        verify(
            windowMock.withProgress(
                deepEqual({ location: vscode.ProgressLocation.Notification }),
                anyFunction()
            )
        ).called();
        verify(mockedStatusItem.showStatusWhileRunning(anything(), anyFunction())).never();
    });

    test("Update fetching", async () => {
        // Setup progress
        configurationMock.setValue("progress");
        new SwiftBuildStatus(instance(mockedStatusItem));
        listenerMock.notifyAll({ execution: mockedTaskExecution });

        // Setup swiftStatus
        configurationMock.setValue("swiftStatus");
        new SwiftBuildStatus(instance(mockedStatusItem));
        listenerMock.notifyAll({ execution: mockedTaskExecution });

        const mockReporter = mock<vscode.Progress<{ message: string }>>();
        const [, statusCallback] = capture<vscode.Task, () => void>(
            mockedStatusItem.showStatusWhileRunning
        ).last();
        const [, progressCallback] = capture<
            vscode.ProgressOptions,
            (p: vscode.Progress<unknown>) => Promise<void>
        >(windowMock.withProgress).last();

        // Execute callback reporters
        statusCallback();
        progressCallback(instance(mockReporter));

        mockedProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "Fetched https://github.com/apple/example-package-figlet from cache (0.43s)\n" +
                "Fetching https://github.com/apple/swift-testing.git from cache\n" +
                "Fetched https://github.com/apple/swift-testing.git from cache (0.77s)\n"
        );

        const expected = "My Task fetching dependencies";
        verify(mockReporter.report(deepEqual({ message: expected }))).called();
        verify(mockedStatusItem.update(mockedTaskExecution.task, expected)).called();
    });

    test("Update build progress", async () => {
        // Setup progress
        configurationMock.setValue("progress");
        new SwiftBuildStatus(instance(mockedStatusItem));
        listenerMock.notifyAll({ execution: mockedTaskExecution });

        // Setup swiftStatus
        configurationMock.setValue("swiftStatus");
        new SwiftBuildStatus(instance(mockedStatusItem));
        listenerMock.notifyAll({ execution: mockedTaskExecution });

        const mockReporter = mock<vscode.Progress<{ message: string }>>();
        const [, statusCallback] = capture<vscode.Task, () => void>(
            mockedStatusItem.showStatusWhileRunning
        ).last();
        const [, progressCallback] = capture<
            vscode.ProgressOptions,
            (p: vscode.Progress<unknown>) => Promise<void>
        >(windowMock.withProgress).last();

        // Execute callback reporters
        statusCallback();
        progressCallback(instance(mockReporter));

        mockedProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "[6/7] Building main.swift\n" +
                "[7/7] Applying MyCLI\n"
        );

        const expected = "My Task [7/7]";
        verify(mockReporter.report(deepEqual({ message: expected }))).called();
        verify(mockedStatusItem.update(mockedTaskExecution.task, expected)).called();

        // Ignore old stuff
        verify(
            mockReporter.report(deepEqual({ message: "My Task fetching dependencies" }))
        ).never();
        verify(mockReporter.report(deepEqual({ message: "My Task [6/7]" }))).never();
    });

    test("Build complete", async () => {
        // Setup progress
        configurationMock.setValue("progress");
        new SwiftBuildStatus(instance(mockedStatusItem));
        listenerMock.notifyAll({ execution: mockedTaskExecution });

        // Setup swiftStatus
        configurationMock.setValue("swiftStatus");
        new SwiftBuildStatus(instance(mockedStatusItem));
        listenerMock.notifyAll({ execution: mockedTaskExecution });

        const mockReporter = mock<vscode.Progress<{ message: string }>>();
        const [, statusCallback] = capture<vscode.Task, () => void>(
            mockedStatusItem.showStatusWhileRunning
        ).last();
        const [, progressCallback] = capture<
            vscode.ProgressOptions,
            (p: vscode.Progress<unknown>) => Promise<void>
        >(windowMock.withProgress).last();

        // Execute callback reporters
        statusCallback();
        progressCallback(instance(mockReporter));

        mockedProcess.write(
            "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "[6/7] Building main.swift\n" +
                "[7/7] Applying MyCLI\n" +
                "Build complete!"
        );

        // Report nothing
        verify(mockReporter.report(anything())).never();
        verify(mockedStatusItem.update(anything(), anything())).never();
    });
});
