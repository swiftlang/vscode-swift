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
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";
import {
    cleanOutput,
    executeTaskAndWaitForResult,
    mutable,
    waitForEndTaskProcess,
} from "../../utilities";

suite("SwiftPluginTaskProvider Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;

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
            const task = taskProvider.createSwiftPluginTask(folderContext.swiftPackage.plugins[0], {
                cwd: folderContext.folder,
                scope: folderContext.workspaceFolder,
            });
            const { exitCode, output } = await executeTaskAndWaitForResult(task);
            expect(exitCode).to.equal(0);
            expect(cleanOutput(output)).to.include("Hello, World!");
        }).timeout(60000);

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
            expect(exitCode).to.not.equal(0);
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
                expect(task?.detail).to.equal("swift package command_plugin");
            });

            test("executes", async () => {
                assert(task);
                const exitPromise = waitForEndTaskProcess(task);
                await vscode.tasks.executeTask(task);
                const exitCode = await exitPromise;
                expect(exitCode).to.equal(0);
            }).timeout(30000); // 30 seconds to run
        });

        suite("includes command plugin provided by tasks.json", async () => {
            let task: vscode.Task | undefined;

            setup(async () => {
                const tasks = await vscode.tasks.fetchTasks({ type: "swift-plugin" });
                task = tasks.find(t => t.name === "swift: command-plugin from tasks.json");
            });

            test("provides", () => {
                expect(task?.detail).to.equal("swift package command_plugin --foo");
            });

            test("executes", async () => {
                assert(task);
                const exitPromise = waitForEndTaskProcess(task);
                await vscode.tasks.executeTask(task);
                const exitCode = await exitPromise;
                expect(exitCode).to.equal(0);
            }).timeout(30000); // 30 seconds to run
        });
    });
});
