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
import { expect } from "chai";
import { testAssetUri } from "../../fixtures";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Commands } from "../../../src/commands";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

suite("Build Commands", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;
    const uri = testAssetUri("command-plugin/Plugins/command-plugin/command-plugin.swift");

    activateExtensionForSuite({
        async setup(ctx) {
            // Open fixture and set focus to the plugin file under test
            workspaceContext = ctx;
            folderContext = await folderInRootWorkspace("command-plugin", workspaceContext);
            await workspaceContext.focusFolder(folderContext);
            await vscode.window.showTextDocument(uri);

            // These calls are needed for the command plugin command to show up.
            // Otherwise will need to modified swift.disableAutoResolve config and a extension reload,
            // which is not ideal.
            await folderContext.loadSwiftPlugins();
            workspaceContext.updatePluginContextKey();
        },
        testAssets: ["command-plugin"],
    });

    test("Tasks: Run Task, swift-plugin", async () => {
        // This will show a quick pick and is difficult to mock, since the tasks are already tested
        // in the SwiftPluginTaskProvider integration test, just validate the arguments are valid.
        const args = await vscode.commands.executeCommand(Commands.RUN_PLUGIN_TASK);
        const tasks = await vscode.tasks.fetchTasks(args as vscode.TaskFilter);

        // Assert that there are exactly two tasks fetched
        // One from tasks.json, another from the SwiftPluginTaskProvider
        expect(tasks.length).to.equal(2);

        // Check if both tasks have the and names
        const taskLabels = tasks.map(task => task.name);
        const expectedLabels = [
            "swift-plugin: command-plugin",
            "swift: command-plugin from tasks.json",
        ];
        expect(taskLabels).to.deep.equal(expectedLabels);
    });
});
