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
import { SwiftPluginTaskProvider } from "../../../src/tasks/SwiftPluginTaskProvider";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { SwiftExecution } from "../../../src/tasks/SwiftExecution";
import { Version } from "../../../src/utilities/version";
import { BuildFlags } from "../../../src/toolchain/BuildFlags";
import { anything, deepEqual, instance, mock, when } from "ts-mockito";

suite("SwiftPluginTaskProvider Unit Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let workspaceFolder: vscode.WorkspaceFolder;
    let toolchain: SwiftToolchain;
    let buildFlags: BuildFlags;

    setup(async () => {
        workspaceContext = mock(WorkspaceContext);
        toolchain = mock(SwiftToolchain);
        buildFlags = mock(BuildFlags);
        workspaceFolder = {
            uri: vscode.Uri.file("/path/to/workspace"),
            name: "myWorkspace",
            index: 0,
        };
        when(buildFlags.withSwiftSDKFlags(anything())).thenCall(args => args);
        when(toolchain.swiftVersion).thenReturn(new Version(6, 0, 0));
        when(toolchain.buildFlags).thenReturn(instance(buildFlags));
        when(toolchain.getToolchainExecutable("swift")).thenReturn("/path/to/bin/swift");
        when(workspaceContext.toolchain).thenReturn(instance(toolchain));
    });

    suite("resolveTask", () => {
        test("uses SwiftExecution", async () => {
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift",
                    args: [],
                },
                workspaceFolder,
                "run PackageExe",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            assert.equal(resolvedTask.execution instanceof SwiftExecution, true);
        });

        test("uses toolchain swift path", async () => {
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift",
                    args: [],
                },
                workspaceFolder,
                "run PackageExe",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.equal(swiftExecution.command, "/path/to/bin/swift");
        });

        test("includes task's cwd", async () => {
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift-plugin",
                    args: [],
                    cwd: `${workspaceFolder.uri.fsPath}/myCWD`,
                },
                workspaceFolder,
                "MyPlugin",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.equal(swiftExecution.options.cwd, `${workspaceFolder.uri.fsPath}/myCWD`);
        });

        test("includes scope cwd", async () => {
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift-plugin",
                    args: [],
                },
                workspaceFolder,
                "MyPlugin",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.equal(swiftExecution.options.cwd, workspaceFolder.uri.fsPath);
        });

        test("includes resolved cwd", async () => {
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift-plugin",
                    args: [],
                    cwd: "myCWD",
                },
                workspaceFolder,
                "MyPlugin",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.equal(swiftExecution.options.cwd, `${workspaceFolder.uri.fsPath}/myCWD`);
        });

        test("includes fallback cwd", async () => {
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift-plugin",
                    args: [],
                    cwd: "myCWD",
                },
                vscode.TaskScope.Global,
                "MyPlugin",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.equal(swiftExecution.options.cwd, "myCWD");
        });

        test("includes command as argument", async () => {
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift-plugin",
                    args: [],
                    command: "my-plugin",
                },
                workspaceFolder,
                "MyPlugin",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.deepEqual(swiftExecution.args, ["package", "my-plugin"]);
        });

        test("includes sdk flags", async () => {
            when(buildFlags.withSwiftSDKFlags(deepEqual(["package", "my-plugin"]))).thenReturn([
                "package",
                "my-plugin",
                "--sdk",
                "/path/to/sdk",
            ]);
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift-plugin",
                    args: [],
                    command: "my-plugin",
                },
                workspaceFolder,
                "MyPlugin",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.deepEqual(swiftExecution.args, [
                "package",
                "my-plugin",
                "--sdk",
                "/path/to/sdk",
            ]);
        });

        test("disables sandbox", async () => {
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift-plugin",
                    args: [],
                    command: "my-plugin",
                    disableSandbox: true,
                },
                workspaceFolder,
                "MyPlugin",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.deepEqual(swiftExecution.args, ["package", "--disable-sandbox", "my-plugin"]);
        });

        test("allows writing to package directory", async () => {
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift-plugin",
                    args: [],
                    command: "my-plugin",
                    allowWritingToPackageDirectory: true,
                },
                workspaceFolder,
                "MyPlugin",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.deepEqual(swiftExecution.args, [
                "package",
                "--allow-writing-to-package-directory",
                "my-plugin",
            ]);
        });
    });
});
