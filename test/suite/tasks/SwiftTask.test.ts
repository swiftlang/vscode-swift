//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as assert from "assert";
import { testSwiftTask } from "../../fixtures";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { globalWorkspaceContextPromise } from "../extension.test";
import { executeTaskAndWaitForResult, waitForNoRunningTasks, waitForWrite } from "../../utilities";
import { SwiftProgress, SwiftTask } from "../../../src/tasks/SwiftTask";

suite("SwiftTask Tests Suite", () => {
    let workspaceContext: WorkspaceContext;
    let workspaceFolder: vscode.WorkspaceFolder;

    suiteSetup(async () => {
        workspaceContext = await globalWorkspaceContextPromise;
        assert.notEqual(workspaceContext.folders.length, 0);
        workspaceFolder = workspaceContext.folders[0].workspaceFolder;
    });

    setup(async () => {
        await waitForNoRunningTasks();
    });

    test("Use provided cwd", async () => {
        const task = new SwiftTask(
            { type: "swift", cwd: "/path/to/workspace" },
            vscode.TaskScope.Workspace,
            "build me",
            "swift build",
            "swift",
            "swift",
            ["build"]
        );
        assert.equal(task.execution.options.cwd, "/path/to/workspace");
    });

    test("Use scope as cwd", async () => {
        const task = new SwiftTask(
            { type: "swift", cwd: undefined },
            workspaceFolder,
            "build me",
            "swift build",
            "swift",
            "swift",
            ["build"]
        );
        assert.equal(task.execution.options.cwd, workspaceFolder.uri.fsPath);
    });

    test("No cwd resolved", async () => {
        const task = new SwiftTask(
            { type: "swift", cwd: undefined },
            vscode.TaskScope.Workspace,
            "build me",
            "swift build",
            "swift",
            "swift",
            ["build"]
        );
        assert.equal(task.execution.options.cwd, undefined);
    });

    test("Close event handler fires", async () => {
        const fixture = testSwiftTask("swift", ["build"], workspaceFolder);
        const promise = executeTaskAndWaitForResult(fixture);
        fixture.process.close(1);
        const { exitCode } = await promise;
        assert.equal(exitCode, 1);
    });

    test("Fetching event handler fires", async () => {
        let fetching = false;
        const { task, process } = testSwiftTask("swift", ["build"], workspaceFolder);
        task.onFetching(() => (fetching = true));

        // Write some non-fetching output
        let promise = waitForWrite(task.execution);
        await vscode.tasks.executeTask(task);
        process.write("Building for debugging...");
        await promise;

        assert.equal(fetching, false);

        // Write build complete message
        promise = waitForWrite(task.execution);
        process.write("Fetching https://github.com/apple/example-package-figlet from cache");
        await promise;
        assert.equal(fetching, true);
    });

    test("Progress event handler fires", async () => {
        let progress: SwiftProgress | undefined;
        const { task, process } = testSwiftTask("swift", ["build"], workspaceFolder);
        task.onProgress(p => (progress = p));

        // Write some non-progress output
        let promise = waitForWrite(task.execution);
        await vscode.tasks.executeTask(task);
        process.write("Building for debugging...");
        await promise;

        assert.equal(progress, undefined);

        // Write progress message
        promise = waitForWrite(task.execution);
        process.write("[1/2] Write swift-version--58304C5D6DBC2206.txt");
        await promise;
        assert.equal(progress?.completed, 1);
        assert.equal(progress?.total, 2);

        // Write updated progress message
        promise = waitForWrite(task.execution);
        process.write("[5/7] Building main.swift");
        await promise;
        assert.equal(progress?.completed, 5);
        assert.equal(progress?.total, 7);
    });

    test("Build complete event handler fires", async () => {
        let completed = false;
        const { task, process } = testSwiftTask("swift", ["build"], workspaceFolder);
        task.onBuildComplete(() => (completed = true));

        // Write some non-completion output
        let promise = waitForWrite(task.execution);
        await vscode.tasks.executeTask(task);
        process.write("Fetching https://github.com/apple/example-package-figlet from cache");
        await promise;

        assert.equal(completed, false);

        // Write build complete message
        promise = waitForWrite(task.execution);
        process.write("Build complete! (0.65s)");
        await promise;

        assert.equal(completed, true);
    });

    test("Product build complete event handler fires", async () => {
        let completed = false;
        const { task, process } = testSwiftTask("swift", ["run", "MyExe"], workspaceFolder);
        task.onBuildComplete(() => (completed = true));

        // Write some non-completion output
        let promise = waitForWrite(task.execution);
        await vscode.tasks.executeTask(task);
        process.write("Fetching https://github.com/apple/example-package-figlet from cache");
        await promise;

        assert.equal(completed, false);

        // Write build complete message
        promise = waitForWrite(task.execution);
        process.write("Build of product 'MyExe' complete! (0.12s)");
        await promise;

        assert.equal(completed, true);
    });

    test("Only fires latest interesting event", async () => {
        let fetching = false;
        let progress: SwiftProgress | undefined;
        let completed = false;
        const { task, process } = testSwiftTask("swift", ["build"], workspaceFolder);
        task.onFetching(() => (fetching = true));
        task.onProgress(p => (progress = p));
        task.onBuildComplete(() => (completed = true));

        const promise = waitForWrite(task.execution);
        await vscode.tasks.executeTask(task);
        process.write(
            "Building for debugging...\n" +
                "Fetching https://github.com/apple/example-package-figlet from cache\n" +
                "[1/2] Write swift-version--58304C5D6DBC2206.txt\n" +
                "[5/7] Building main.swift\n" +
                "Build complete! (0.65s)"
        );
        await promise;

        // Should not have fired
        assert.equal(fetching, false);
        assert.equal(progress, undefined);
        // Should have fired
        assert.equal(completed, true);
    });
});
