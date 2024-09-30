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
import * as assert from "assert";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { folderContextPromise, globalWorkspaceContextPromise } from "../extension.test";
import { SwiftPluginTaskProvider } from "../../../src/tasks/SwiftPluginTaskProvider";
import { FolderContext } from "../../../src/FolderContext";
import { executeTaskAndWaitForResult, mutable, waitForEndTaskProcess } from "../../utilities";

suite("SwiftPluginTaskProvider Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;

    suiteSetup(async () => {
        workspaceContext = await globalWorkspaceContextPromise;
        folderContext = await folderContextPromise("command-plugin");
        assert.notEqual(workspaceContext.folders.length, 0);
        await folderContext.loadSwiftPlugins();
        assert.notEqual(folderContext.swiftPackage.plugins.length, 0);
    });

    suite("createSwiftPluginTask", () => {
        let taskProvider: SwiftPluginTaskProvider;

        setup(() => {
            taskProvider = new SwiftPluginTaskProvider(workspaceContext);
        });

        test("Exit code on success", async () => {
            const task = taskProvider.createSwiftPluginTask(folderContext.swiftPackage.plugins[0], {
                cwd: folderContext.folder,
                scope: folderContext.workspaceFolder,
            });
            const { exitCode, output } = await executeTaskAndWaitForResult(task);
            assert.equal(exitCode, 0);
            assert.equal(output.trim(), "Hello, World!");
        }).timeout(10000);

        test("Exit code on failure", async () => {
            const task = taskProvider.createSwiftPluginTask(
                {
                    command: "not_a_command",
                    name: "not_a_command",
                    package: "command-plugin",
                },
                {
                    cwd: folderContext.folder,
                    scope: folderContext.workspaceFolder,
                }
            );
            mutable(task.execution).command = "/definitely/not/swift";
            const { exitCode } = await executeTaskAndWaitForResult(task);
            assert.notEqual(exitCode, 0);
        }).timeout(10000);
    });

    suite("provideTasks", () => {
        suite("includes command plugin provided by the extension", async () => {
            let task: vscode.Task | undefined;

            setup(async () => {
                const tasks = await vscode.tasks.fetchTasks({ type: "swift-plugin" });
                task = tasks.find(t => t.name === "command-plugin");
            });

            test("provides", () => {
                assert.equal(task?.detail, "swift package command_plugin");
            });

            test("executes", async () => {
                assert(task);
                const exitPromise = waitForEndTaskProcess(task);
                await vscode.tasks.executeTask(task);
                const exitCode = await exitPromise;
                assert.equal(exitCode, 0);
            }).timeout(30000); // 30 seconds to run
        });

        suite("includes command plugin provided by tasks.json", async () => {
            let task: vscode.Task | undefined;

            setup(async () => {
                const tasks = await vscode.tasks.fetchTasks({ type: "swift-plugin" });
                task = tasks.find(t => t.name === "swift: command-plugin from tasks.json");
            });

            test("provides", () => {
                assert.equal(task?.detail, "swift package command_plugin --foo");
            });

            test("executes", async () => {
                assert(task);
                const exitPromise = waitForEndTaskProcess(task);
                await vscode.tasks.executeTask(task);
                const exitCode = await exitPromise;
                assert.equal(exitCode, 0);
            }).timeout(30000); // 30 seconds to run
        });
    });
});
