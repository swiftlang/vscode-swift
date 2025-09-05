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
import * as assert from "assert";
import { expect } from "chai";
import { afterEach, beforeEach } from "mocha";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { SwiftExecution } from "@src/tasks/SwiftExecution";
import { SwiftPluginTaskProvider } from "@src/tasks/SwiftPluginTaskProvider";
import { SwiftTask } from "@src/tasks/SwiftTaskProvider";

import {
    cleanOutput,
    executeTaskAndWaitForResult,
    waitForEndTaskProcess,
} from "../../utilities/tasks";
import { mutable } from "../../utilities/types";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "../utilities/testutilities";

suite("SwiftPluginTaskProvider Test Suite", function () {
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            folderContext = await folderInRootWorkspace("command-plugin", workspaceContext);
            const logger = await ctx.loggerFactory.temp("SwiftPluginTaskProvider.tests");
            await folderContext.loadSwiftPlugins(logger);
            expect(logger.logs.length).to.equal(0, `Expected no output channel logs`);
            expect(workspaceContext.folders).to.not.have.lengthOf(0);
        },
    });

    const expectedPluginPermissions = [
        "--disable-sandbox",
        "--allow-writing-to-package-directory",
        "--allow-writing-to-directory",
        "/foo",
        "/bar",
        "--allow-network-connections",
        "all",
    ];

    [
        {
            name: "global plugin permissions",
            settings: {
                "swift.pluginPermissions": {
                    disableSandbox: true,
                    allowWritingToPackageDirectory: true,
                    allowWritingToDirectory: ["/foo", "/bar"],
                    allowNetworkConnections: "all",
                },
            },
            expected: expectedPluginPermissions,
        },
        {
            name: "plugin scoped plugin permissions",
            settings: {
                "swift.pluginPermissions": {
                    "command-plugin": {
                        disableSandbox: true,
                        allowWritingToPackageDirectory: true,
                        allowWritingToDirectory: ["/foo", "/bar"],
                        allowNetworkConnections: "all",
                    },
                },
            },
            expected: expectedPluginPermissions,
        },
        {
            name: "command scoped plugin permissions",
            settings: {
                "swift.pluginPermissions": {
                    "command-plugin:command_plugin": {
                        disableSandbox: true,
                        allowWritingToPackageDirectory: true,
                        allowWritingToDirectory: ["/foo", "/bar"],
                        allowNetworkConnections: "all",
                    },
                },
            },
            expected: expectedPluginPermissions,
        },
        {
            name: "wildcard scoped plugin permissions",
            settings: {
                "swift.pluginPermissions": {
                    "*": {
                        disableSandbox: true,
                        allowWritingToPackageDirectory: true,
                        allowWritingToDirectory: ["/foo", "/bar"],
                        allowNetworkConnections: "all",
                    },
                },
            },
            expected: expectedPluginPermissions,
        },
        {
            name: "global plugin arguments",
            settings: {
                "swift.pluginArguments": ["-c", "release"],
            },
            expected: ["-c", "release"],
        },
        {
            name: "plugin scoped plugin arguments",
            settings: {
                "swift.pluginArguments": {
                    "command-plugin": ["-c", "release"],
                },
            },
            expected: ["-c", "release"],
        },
        {
            name: "command scoped plugin arguments",
            settings: {
                "swift.pluginArguments": {
                    "command-plugin:command_plugin": ["-c", "release"],
                },
            },
            expected: ["-c", "release"],
        },
        {
            name: "wildcard scoped plugin arguments",
            settings: {
                "swift.pluginArguments": {
                    "*": ["-c", "release"],
                },
            },
            expected: ["-c", "release"],
        },
        {
            name: "overlays settings",
            settings: {
                "swift.pluginArguments": {
                    "*": ["-a"],
                    "command-plugin": ["-b"],
                    "command-plugin:command_plugin": ["-c"],
                },
            },
            expected: ["-a", "-b", "-c"],
        },
    ].forEach(({ name, settings, expected }) => {
        suite(name, () => {
            let resetSettings: (() => Promise<void>) | undefined;
            beforeEach(async function () {
                resetSettings = await updateSettings(settings);
            });

            afterEach(async () => {
                if (resetSettings) {
                    await resetSettings();
                    resetSettings = undefined;
                }
            });

            test("sets arguments", async () => {
                const tasks = await vscode.tasks.fetchTasks({ type: "swift-plugin" });
                const task = tasks.find(t => t.name === "command-plugin");
                expect(task).to.not.be.undefined;

                const swiftExecution = task?.execution as SwiftExecution;
                expect(swiftExecution).to.not.be.undefined;
                assert.deepEqual(
                    swiftExecution.args,
                    workspaceContext.globalToolchain.buildFlags.withAdditionalFlags([
                        "package",
                        ...expected,
                        "command_plugin",
                    ])
                );
            });
        });
    });

    suite("execution", () => {
        suite("createSwiftPluginTask", () => {
            let taskProvider: SwiftPluginTaskProvider;

            setup(() => {
                taskProvider = workspaceContext.pluginProvider;
            });

            test("Exit code on success", async () => {
                const task = taskProvider.createSwiftPluginTask(
                    folderContext.swiftPackage.plugins[0],
                    folderContext.toolchain,
                    {
                        cwd: folderContext.folder,
                        scope: folderContext.workspaceFolder,
                    }
                );
                const { exitCode, output } = await executeTaskAndWaitForResult(task);
                expect(exitCode, output).to.equal(0);
                expect(cleanOutput(output)).to.include("Hello, World!");
            });

            test("Exit code on failure", async () => {
                const task = taskProvider.createSwiftPluginTask(
                    {
                        command: "not_a_command",
                        name: "not_a_command",
                        package: "command-plugin",
                    },
                    folderContext.toolchain,
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
            suite("includes command plugin provided by the extension", () => {
                let task: SwiftTask | undefined;

                setup(async () => {
                    const tasks = await vscode.tasks.fetchTasks({ type: "swift-plugin" });
                    task = tasks.find(t => t.name === "command-plugin") as SwiftTask;
                });

                test("provides", () => {
                    expect(task?.execution.args).to.deep.equal(
                        folderContext.toolchain.buildFlags.withAdditionalFlags([
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

            suite("includes command plugin provided by tasks.json", () => {
                let task: SwiftTask | undefined;

                setup(async () => {
                    const tasks = await vscode.tasks.fetchTasks({ type: "swift-plugin" });
                    task = tasks.find(
                        t =>
                            t.name ===
                            "swift: command-plugin from " +
                                (vscode.workspace.workspaceFile ? "code workspace" : "tasks.json")
                    ) as SwiftTask;
                });

                test("provides", () => {
                    expect(task?.execution.args).to.deep.equal(
                        folderContext.toolchain.buildFlags.withAdditionalFlags([
                            "package",
                            "--disable-sandbox",
                            "command_plugin",
                            "--foo",
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
        });
    });
});
