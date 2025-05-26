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

import * as vscode from "vscode";
import { mockGlobalObject } from "../../MockUtils";
import { expect } from "chai";
import { match } from "sinon";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";
import { Commands } from "../../../src/commands";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";

suite("runPluginTask Test Suite", () => {
    const executeCommand = vscode.commands.executeCommand;
    const commandsMock = mockGlobalObject(vscode, "commands");

    activateExtensionForSuite({
        async setup(ctx) {
            const folder = await folderInRootWorkspace("command-plugin", ctx);
            const outputChannel = new SwiftOutputChannel("runPluginTask.tests");
            await folder.loadSwiftPlugins(outputChannel);
        },
    });

    test("Executes runTask command", async () => {
        await executeCommand(Commands.RUN_PLUGIN_TASK);

        expect(commandsMock.executeCommand).to.have.been.calledOnceWith(
            "workbench.action.tasks.runTask",
            match({ type: "swift-plugin" })
        );
    });
});
