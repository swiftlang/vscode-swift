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

import { StatusItem } from "@src/ui/StatusItem";

import { MockedObject, mockFn, mockGlobalObject, mockObject } from "../../MockUtils";

suite("StatusItem Unit Test Suite", function () {
    const windowMock = mockGlobalObject(vscode, "window");

    let statusItem: StatusItem;
    let mockedStatusBarItem: MockedObject<vscode.StatusBarItem>;

    setup(() => {
        mockedStatusBarItem = mockObject<vscode.StatusBarItem>({
            text: "",
            command: undefined,
            accessibilityInformation: undefined,
            show: mockFn(),
            hide: mockFn(),
            dispose: mockFn(),
        });
        windowMock.createStatusBarItem.returns(
            mockedStatusBarItem as unknown as vscode.StatusBarItem
        );
        statusItem = new StatusItem();
    });

    test("showStatusWhileRunning() shows the status bar item and returns the result", async () => {
        const result = await statusItem.showStatusWhileRunning("Build", () => 42);

        expect(mockedStatusBarItem.show).to.have.been.called;
        expect(result).to.equal(42);
    });

    test("showStatusWhileRunning() hides the item once the task ends", async () => {
        await statusItem.showStatusWhileRunning("Build", () => undefined);

        expect(mockedStatusBarItem.hide).to.have.been.called;
    });

    test("showStatusWhileRunning() hides the item if the task throws", async () => {
        await expect(
            statusItem.showStatusWhileRunning("Build", () => {
                throw new Error("build failed");
            })
        ).to.be.rejectedWith("build failed");

        expect(mockedStatusBarItem.hide).to.have.been.called;
    });

    test("displays the task name in the status bar item text", async () => {
        await statusItem.showStatusWhileRunning("Build", () => {
            expect(mockedStatusBarItem.text).to.contain("Build");
        });
    });

    test("sets the click command to reveal the task terminal for vscode.Task instances", async () => {
        const task = new vscode.Task({ type: "swift" }, vscode.TaskScope.Global, "Build", "swift");

        await statusItem.showStatusWhileRunning(task, () => {
            const command = mockedStatusBarItem.command as vscode.Command;
            expect(command.command).to.equal("swift.revealTaskTerminal");
            expect(command.arguments?.[0]).to.equal(task);
        });
    });

    test("does not set a click command for string processes", async () => {
        await statusItem.showStatusWhileRunning("Resolving", () => {
            expect(mockedStatusBarItem.command).to.be.undefined;
        });
    });

    test("update() changes the displayed message for the running task", async () => {
        await statusItem.showStatusWhileRunning("Build", () => {
            statusItem.update("Build", "Build: [3/4]");
            expect(mockedStatusBarItem.text).to.contain("Build: [3/4]");
        });
    });
});
