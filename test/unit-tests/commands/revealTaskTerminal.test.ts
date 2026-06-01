//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
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

import { revealTaskTerminal } from "@src/commands/revealTaskTerminal";

import { instance, mockFn, mockGlobalObject, mockObject } from "../../MockUtils";

suite("revealTaskTerminal Test Suite", () => {
    const windowMock = mockGlobalObject(vscode, "window");
    const commandsMock = mockGlobalObject(vscode, "commands");

    function swiftTask(name: string): vscode.Task {
        return new vscode.Task({ type: "swift" }, vscode.TaskScope.Global, name, "swift");
    }

    test("shows the terminal that matches the task", () => {
        const terminal = mockObject<vscode.Terminal>({
            name: "swift: Build All",
            show: mockFn(),
        });
        windowMock.terminals = [instance(terminal)];

        revealTaskTerminal(swiftTask("Build All"));

        expect(terminal.show).to.have.been.calledOnce;
        expect(commandsMock.executeCommand).to.not.have.been.called;
    });

    test("falls back to the running-tasks picker when no terminal matches", () => {
        windowMock.terminals = [];

        revealTaskTerminal(swiftTask("Build All"));

        expect(commandsMock.executeCommand).to.have.been.calledOnceWith(
            "workbench.action.tasks.showTasks"
        );
    });

    test("falls back to the running-tasks picker when no task is given", () => {
        windowMock.terminals = [];

        revealTaskTerminal();

        expect(commandsMock.executeCommand).to.have.been.calledOnceWith(
            "workbench.action.tasks.showTasks"
        );
    });
});
