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
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { createBuildAllTask, createSwiftTask, getBuildAllTask } from "@src/tasks/SwiftTaskProvider";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Version } from "@src/utilities/version";

import { mockGlobalObject } from "../../MockUtils";
import { tag } from "../../tags";
import {
    executeTaskAndWaitForResult,
    waitForEndTask,
    waitForEndTaskProcess,
} from "../../utilities/tasks";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "../utilities/testutilities";

import assert = require("assert");

async function findBuildAllTask(): Promise<vscode.Task | undefined> {
    const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
    return tasks.find(t => t.name === "Build All (defaultPackage)");
}

async function findBuildAllTaskFromTasksJSON(): Promise<vscode.Task | undefined> {
    const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
    return tasks.find(
        t =>
            t.name ===
            "swift: Build All from " +
                (vscode.workspace.workspaceFile ? "code workspace" : "tasks.json")
    );
}

tag("medium").suite("SwiftTaskProvider Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let toolchain: SwiftToolchain;
    let workspaceFolder: vscode.WorkspaceFolder;
    let folderContext: FolderContext;
    let resetSettings: (() => Promise<void>) | undefined;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            expect(workspaceContext.folders).to.not.have.lengthOf(0);
            workspaceFolder = workspaceContext.folders[0].workspaceFolder;

            // Make sure to add another folder
            folderContext = await folderInRootWorkspace("diagnostics", workspaceContext);
            toolchain = folderContext.toolchain;
        },
    });

    teardown(async () => {
        if (resetSettings) {
            await resetSettings();
        }
    });

    test("provides build all task", async () => {
        await expect(findBuildAllTask())
            .to.eventually.have.property("detail")
            .that.includes("swift build --build-tests");
    });

    test("can execute the build all task", async () => {
        const task = await findBuildAllTask();
        assert(task);
        await vscode.tasks.executeTask(task);
        await Promise.all([
            expect(waitForEndTaskProcess(task)).to.eventually.equal(0),
            waitForEndTask(task),
        ]);
    });

    test("provides build all task from tasks.json", async () => {
        await expect(findBuildAllTaskFromTasksJSON())
            .to.eventually.have.property("detail")
            .that.includes("swift build --show-bin-path");
    });

    test("can execute the build all task from tasks.json", async () => {
        const task = await findBuildAllTaskFromTasksJSON();
        assert(task);
        await vscode.tasks.executeTask(task);
        await Promise.all([
            expect(waitForEndTaskProcess(task)).to.eventually.equal(0),
            waitForEndTask(task),
        ]);
    });

    test("provides product debug task", async () => {
        const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
        expect(tasks.map(t => t.name)).to.include("Build Debug PackageExe (defaultPackage)");
        expect(tasks.find(t => t.name === "Build Debug PackageExe (defaultPackage)"))
            .to.have.property("detail")
            .that.includes("swift build --product PackageExe");
    });

    test("provides library build tasks when enabled in settings", async () => {
        let tasks = await vscode.tasks.fetchTasks({ type: "swift" });
        let taskNames = tasks.map(t => t.name);
        expect(taskNames).to.not.include("Build Debug PackageLib2 (defaultPackage)");
        expect(taskNames).to.not.include("Build Release PackageLib2 (defaultPackage)");

        resetSettings = await updateSettings({
            "swift.createTasksForLibraryProducts": true,
        });

        tasks = await vscode.tasks.fetchTasks({ type: "swift" });
        taskNames = tasks.map(t => t.name);
        expect(taskNames).to.include("Build Debug PackageLib2 (defaultPackage)");
        expect(tasks.find(t => t.name === "Build Debug PackageLib2 (defaultPackage)"))
            .to.have.property("detail")
            .that.includes("swift build --product PackageLib2");
        expect(taskNames).to.include("Build Release PackageLib2 (defaultPackage)");
        expect(tasks.find(t => t.name === "Build Release PackageLib2 (defaultPackage)"))
            .to.have.property("detail")
            .that.includes("swift build -c release --product PackageLib2");

        // Don't include automatic products
        expect(taskNames).to.not.include("Build Debug PackageLib (defaultPackage)");
        expect(taskNames).to.not.include("Build Release PackageLib (defaultPackage)");
    });

    test("provides product release task", async () => {
        const taskProvider = workspaceContext.taskProvider;
        const tasks = await taskProvider.provideTasks(new vscode.CancellationTokenSource().token);
        expect(tasks.map(t => t.name)).to.include("Build Release PackageExe (defaultPackage)");
        expect(tasks.find(t => t.name === "Build Release PackageExe (defaultPackage)"))
            .to.have.property("detail")
            .that.includes("swift build -c release --product PackageExe");
    });

    test("provides tasks for sub-folders with a Package.swift", async () => {
        const diagnosticTasks = (await vscode.tasks.fetchTasks({ type: "swift" }))
            .map(t => t.name)
            .filter(name => name.endsWith("(diagnostics)"));
        expect(diagnosticTasks).to.have.members([
            "Build All (diagnostics)",
            "Build Debug diagnostics (diagnostics)",
            "Build Release diagnostics (diagnostics)",
        ]);
    });

    suite("createSwiftTask()", () => {
        test("returns an exit code of 0 when the process completes successfully", async () => {
            const task = createSwiftTask(
                ["--help"],
                "help",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                toolchain
            );
            await expect(executeTaskAndWaitForResult(task))
                .to.eventually.have.property("exitCode")
                .that.equals(0);
        });

        test("returns a non-zero exit code when the process fails", async () => {
            const task = createSwiftTask(
                ["invalid_swift_command"],
                "invalid",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                toolchain
            );
            await expect(executeTaskAndWaitForResult(task))
                .to.eventually.have.property("exitCode")
                .that.does.not.equal(0);
        });

        test("returns a non-zero exit code if the swift binary could not be found", async () => {
            const task = createSwiftTask(
                ["--help"],
                "help",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                new SwiftToolchain(
                    "unknown",
                    "/invalid/swift/path",
                    "/invalid/toolchain/path",
                    {
                        compilerVersion: "1.2.3",
                        paths: {
                            runtimeLibraryPaths: [],
                        },
                    },
                    new Version(1, 2, 3)
                )
            );
            await expect(executeTaskAndWaitForResult(task))
                .to.eventually.have.property("exitCode")
                .that.does.not.equal(0);
        });
    });

    suite("createBuildAllTask()", () => {
        test("returns the same task instance when called multiple times", async () => {
            expect(await createBuildAllTask(folderContext)).to.equal(
                await createBuildAllTask(folderContext)
            );
        });

        test("returns a different task when release mode is enabled", async () => {
            expect(await createBuildAllTask(folderContext)).to.not.equal(
                await createBuildAllTask(folderContext, true)
            );
        });
    });

    suite("getBuildAllTask()", () => {
        const tasksMock = mockGlobalObject(vscode, "tasks");

        test("creates build all task when it cannot find one", async () => {
            tasksMock.fetchTasks.resolves([]);
            await expect(getBuildAllTask(folderContext)).to.eventually.equal(
                await createBuildAllTask(folderContext)
            );
        });
    });
});
