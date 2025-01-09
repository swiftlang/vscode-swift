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
import { expect } from "chai";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { SwiftPluginTaskProvider } from "../../../src/tasks/SwiftPluginTaskProvider";
import { FolderContext } from "../../../src/FolderContext";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "../utilities/testutilities";
import {
    cleanOutput,
    executeTaskAndWaitForResult,
    waitForEndTaskProcess,
} from "../../utilities/tasks";
import { mutable } from "../../utilities/types";
import { SwiftExecution } from "../../../src/tasks/SwiftExecution";
import { SwiftTask } from "../../../src/tasks/SwiftTaskProvider";

suite("SwiftPluginTaskProvider Test Suite", function () {
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;

    this.timeout(60000); // Mostly only when running suite with .only

    suite("settings plugin arguments", () => {
        activateExtensionForSuite({
            async setup(ctx) {
                workspaceContext = ctx;
                folderContext = await folderInRootWorkspace("command-plugin", workspaceContext);
                await folderContext.loadSwiftPlugins();
                expect(workspaceContext.folders).to.not.have.lengthOf(0);
                return await updateSettings({
                    "swift.pluginPermissions": {
                        "command-plugin:command_plugin": {
                            disableSandbox: true,
                            allowWritingToPackageDirectory: true,
                            allowWritingToDirectory: ["/foo", "/bar"],
                            allowNetworkConnections: "all",
                        },
                    },
                });
            },
        });

        test("provides a task with permissions set via settings", async () => {
            const tasks = await vscode.tasks.fetchTasks({ type: "swift-plugin" });
            const task = tasks.find(t => t.name === "command-plugin");
            const swiftExecution = task?.execution as SwiftExecution;
            assert.deepEqual(
                swiftExecution.args,
                workspaceContext.toolchain.buildFlags.withAdditionalFlags([
                    "package",
                    "--disable-sandbox",
                    "--allow-writing-to-package-directory",
                    "--allow-writing-to-directory",
                    "/foo",
                    "/bar",
                    "--allow-network-connections",
                    "all",
                    "command_plugin",
                ])
            );
        });
    });

    suite("execution", () => {
        activateExtensionForSuite({
            async setup(ctx) {
                workspaceContext = ctx;
                folderContext = await folderInRootWorkspace("command-plugin", workspaceContext);
                await folderContext.loadSwiftPlugins();
                expect(workspaceContext.folders).to.not.have.lengthOf(0);
            },
        });

        suite("createSwiftPluginTask", () => {
            let taskProvider: SwiftPluginTaskProvider;

            setup(() => {
                taskProvider = new SwiftPluginTaskProvider(workspaceContext);
            });

            test("Exit code on success", async () => {
                const task = taskProvider.createSwiftPluginTask(
                    folderContext.swiftPackage.plugins[0],
                    {
                        cwd: folderContext.folder,
                        scope: folderContext.workspaceFolder,
                    }
                );
                const { exitCode, output } = await executeTaskAndWaitForResult(task);
                expect(exitCode).to.equal(0);
                expect(cleanOutput(output)).to.include("Hello, World!");
            });

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
                const { exitCode, output } = await executeTaskAndWaitForResult(task);
                expect(exitCode, `${output}`).to.not.equal(0);
            });
        });

        suite("provideTasks", () => {
            suite("includes command plugin provided by the extension", async () => {
                let task: SwiftTask | undefined;

                setup(async () => {
                    const tasks = await vscode.tasks.fetchTasks({ type: "swift-plugin" });
                    task = tasks.find(t => t.name === "command-plugin") as SwiftTask;
                });

                test("provides", () => {
                    expect(task?.execution.args).to.deep.equal(
                        workspaceContext.toolchain.buildFlags.withAdditionalFlags([
                            "package",
                            "command_plugin",
                        ])
                    );
                });

                test("executes", async () => {
                    assert(task);
                    const exitPromise = waitForEndTaskProcess(task);
                    await vscode.tasks.executeTask(task);
                    const exitCode = await exitPromise;
                    expect(exitCode).to.equal(0);
                });
            });

            suite("includes command plugin provided by tasks.json", async () => {
                let task: vscode.Task | undefined;

                setup(async () => {
                    const tasks = await vscode.tasks.fetchTasks({ type: "swift-plugin" });
                    task = tasks.find(t => t.name === "swift: command-plugin from tasks.json");
                });

                test("provides", () => {
                    expect(task?.detail).to.include("swift package command_plugin --foo");
                });

                test("executes", async () => {
                    assert(task);
                    const exitPromise = waitForEndTaskProcess(task);
                    await vscode.tasks.executeTask(task);
                    const exitCode = await exitPromise;
                    expect(exitCode).to.equal(0);
                });
            });
        });
    });
});
