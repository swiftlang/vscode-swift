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
import * as os from "os";
import { match } from "sinon";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { PackagePlugin } from "@src/SwiftPackage";
import { WorkspaceContext } from "@src/WorkspaceContext";
import configuration from "@src/configuration";
import { SwiftExecution } from "@src/tasks/SwiftExecution";
import { SwiftPluginTaskProvider } from "@src/tasks/SwiftPluginTaskProvider";
import { SwiftTask } from "@src/tasks/SwiftTaskProvider";
import { BuildFlags } from "@src/toolchain/BuildFlags";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Version } from "@src/utilities/version";

import { MockedObject, instance, mockFn, mockGlobalValue, mockObject } from "../../MockUtils";
import { makeWorkspaceState } from "./fixtures/pluginFixtures";

suite("SwiftPluginTaskProvider Unit Test Suite", () => {
    let workspaceContext: MockedObject<WorkspaceContext>;
    let workspaceFolder: vscode.WorkspaceFolder;
    let toolchain: MockedObject<SwiftToolchain>;
    let buildFlags: MockedObject<BuildFlags>;

    setup(async () => {
        buildFlags = mockObject<BuildFlags>({
            withAdditionalFlags: mockFn(s => s.callsFake(args => args)),
        });
        toolchain = mockObject<SwiftToolchain>({
            swiftVersion: new Version(6, 0, 0),
            buildFlags: instance(buildFlags),
            getToolchainInvocation: mockFn(s =>
                s.withArgs("swift", match.any).callsFake((_exe: string, args: string[]) => ({
                    command: "/path/to/bin/swift",
                    args,
                }))
            ),
        });
        const folderContext = mockObject<FolderContext>({
            workspaceContext: instance(workspaceContext),
            workspaceFolder,
            toolchain: instance(toolchain),
        });
        workspaceContext = mockObject<WorkspaceContext>({
            globalToolchain: instance(toolchain),
            currentFolder: instance(folderContext),
        });
        workspaceFolder = {
            uri: vscode.Uri.file("/path/to/workspace"),
            name: "myWorkspace",
            index: 0,
        };
    });

    suite("resolveTask", () => {
        const configurationMock = mockGlobalValue(configuration, "swiftEnvironmentVariables");

        setup(async () => {
            configurationMock.setValue({
                FOO: "bar",
            });
        });

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
            expect(swiftExecution.options.cwd).to.equalPath(`${workspaceFolder.uri.fsPath}/myCWD`);
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
            expect(swiftExecution.options.cwd).to.equalPath(workspaceFolder.uri.fsPath);
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
            expect(swiftExecution.options.cwd).to.equalPath(`${workspaceFolder.uri.fsPath}/myCWD`);
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
            buildFlags.withAdditionalFlags
                .withArgs(match(["package", "my-plugin"]))
                .returns(["package", "my-plugin", "--sdk", "/path/to/sdk"]);
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

        test("substitutes variables", async () => {
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift-plugin",
                    args: ["${cwd}", "${userHome}"],
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
                process.cwd(),
                os.homedir(),
            ]);
        });

        test("provides environment", async () => {
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
            assert.equal(swiftExecution.options.env?.FOO, "bar");
        });
    });

    suite("createSwiftPluginTask trusted-plugin auto-elevation", () => {
        // Integration-level checks that getTaskDefinition's spread correctly
        // forwards the result of getTrustedPluginPermissions to the resolved
        // task. The exhaustive matrix lives in TrustedPlugins.test.ts.
        type WorkspaceStateFixture = ReturnType<typeof makeWorkspaceState>;

        function buildTask(
            plugin: PackagePlugin,
            workspaceState?: WorkspaceStateFixture
        ): SwiftTask {
            const taskProvider = new SwiftPluginTaskProvider(instance(workspaceContext));
            return taskProvider.createSwiftPluginTask(plugin, instance(toolchain), {
                cwd: workspaceFolder.uri,
                scope: workspaceFolder,
                workspaceState,
            });
        }

        function flagsFromTask(task: SwiftTask): string[] {
            return (task.execution as SwiftExecution).args;
        }

        test("auto-elevates SwiftDocCPlugin/preview-documentation from the canonical URL", () => {
            const task = buildTask(
                {
                    command: "preview-documentation",
                    name: "Swift-DocC",
                    package: "SwiftDocCPlugin",
                },
                makeWorkspaceState([
                    {
                        name: "SwiftDocCPlugin",
                        location: "https://github.com/swiftlang/swift-docc-plugin",
                    },
                ])
            );
            expect(flagsFromTask(task)).to.include.members([
                "--disable-sandbox",
                "--allow-writing-to-package-directory",
            ]);
        });

        test("surfaces disableTaskQueue on the task definition for swift-aws-lambda-runtime/archive", () => {
            // disableTaskQueue is not a CLI flag; it lives on the task
            // definition. Pin that the spread merges it through correctly.
            const task = buildTask(
                {
                    command: "archive",
                    name: "AWSLambdaPackager",
                    package: "swift-aws-lambda-runtime",
                },
                makeWorkspaceState([
                    {
                        name: "swift-aws-lambda-runtime",
                        location: "https://github.com/swift-server/swift-aws-lambda-runtime",
                    },
                ])
            );
            expect(task.definition.disableTaskQueue).to.equal(true);
        });

        test("does NOT auto-elevate when a root package spoofs the SwiftDocCPlugin name", () => {
            const flags = flagsFromTask(
                buildTask(
                    {
                        command: "preview-documentation",
                        name: "Trojan",
                        package: "SwiftDocCPlugin",
                    },
                    makeWorkspaceState([])
                )
            );
            expect(flags).to.not.include("--disable-sandbox");
            expect(flags).to.not.include("--allow-writing-to-package-directory");
        });
    });
});
