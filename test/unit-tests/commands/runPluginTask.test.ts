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
import { match } from "sinon";
import * as vscode from "vscode";

import { runPluginTask } from "@src/commands/runPluginTask";

import { mockGlobalObject } from "../../MockUtils";

suite("runPluginTask Test Suite", () => {
    const commandsMock = mockGlobalObject(vscode, "commands");

    test("Executes runTask command", async () => {
        await runPluginTask();

        expect(commandsMock.executeCommand).to.have.been.calledOnceWith(
            "workbench.action.tasks.runTask",
            match({ type: "swift-plugin" })
        );
    });
});
