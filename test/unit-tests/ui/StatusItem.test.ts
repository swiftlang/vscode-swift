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
    let mockedProgress: MockedObject<vscode.Progress<{ message?: string }>>;

    setup(() => {
        mockedProgress = mockObject<vscode.Progress<{ message?: string }>>({
            report: mockFn(),
        });
        windowMock.withProgress.callsFake(async (_options, task) => {
            return task(
                mockedProgress as unknown as vscode.Progress<{ message?: string }>,
                {} as vscode.CancellationToken
            );
        });
        statusItem = new StatusItem();
    });

    test("showStatusWhileRunning() wraps process in withProgress and returns result", async () => {
        const result = await statusItem.showStatusWhileRunning("Build", () => 42);

        expect(windowMock.withProgress).to.have.been.calledOnce;
        const options = windowMock.withProgress.firstCall.args[0];
        expect(options.location).to.equal(vscode.ProgressLocation.Window);
        expect(result).to.equal(42);
    });

    test("showStatusWhileRunning() reports task name as initial message", async () => {
        await statusItem.showStatusWhileRunning("Build", () => undefined);

        expect(mockedProgress.report).to.have.been.calledWith({ message: "Build" });
    });

    test("showStatusWhileRunning() cleans up on error and rethrows", async () => {
        const error = new Error("build failed");

        await expect(
            statusItem.showStatusWhileRunning("Build", () => {
                throw error;
            })
        ).to.be.rejectedWith("build failed");
    });
});
