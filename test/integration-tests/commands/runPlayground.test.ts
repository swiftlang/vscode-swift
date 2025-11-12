//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
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
import { Commands } from "@src/commands";
import { SwiftTask } from "@src/tasks/SwiftTaskProvider";

import { mockGlobalObject } from "../../MockUtils";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

suite("Run Playground Command", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;

    const mockTasks = mockGlobalObject(vscode, "tasks");

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
        },
    });

    setup(async () => {
        await workspaceContext.focusFolder(folderContext);
    });

    test("No playground item provided", async () => {
        expect(await vscode.commands.executeCommand(Commands.PLAY), undefined).to.be.false;
        expect(mockTasks.executeTask).to.not.have.been.called;
    });

    test("No folder focussed", async () => {
        await workspaceContext.focusFolder(null);
        expect(
            await vscode.commands.executeCommand(Commands.PLAY, {
                id: "PackageLib/PackageLib.swift:3",
            })
        ).to.be.false;
        expect(mockTasks.executeTask).to.not.have.been.called;
    });

    test('Runs "swift play" on "id"', async () => {
        expect(
            await vscode.commands.executeCommand(Commands.PLAY, {
                id: "PackageLib/PackageLib.swift:3",
            })
        ).to.be.true;
        expect(mockTasks.executeTask).to.have.been.calledOnce;

        const task = mockTasks.executeTask.args[0][0] as SwiftTask;
        expect(task.execution.args).to.deep.equal(["play", "PackageLib/PackageLib.swift:3"]);
        expect(task.execution.options.cwd).to.equal(folderContext.folder.fsPath);
    });

    test('Runs "swift play" on "id" with space in path', async () => {
        expect(
            await vscode.commands.executeCommand(Commands.PLAY, {
                id: "PackageLib/Package Lib.swift:3",
            })
        ).to.be.true;
        expect(mockTasks.executeTask).to.have.been.calledOnce;

        const task = mockTasks.executeTask.args[0][0] as SwiftTask;
        expect(task.execution.args).to.deep.equal(["play", "PackageLib/Package Lib.swift:3"]);
        expect(task.execution.options.cwd).to.equal(folderContext.folder.fsPath);
    });

    test('Runs "swift play" on "label"', async () => {
        expect(
            await vscode.commands.executeCommand(Commands.PLAY, {
                id: "PackageLib/PackageLib.swift:3",
                label: "bar",
            })
        ).to.be.true;
        expect(mockTasks.executeTask).to.have.been.calledOnce;

        const task = mockTasks.executeTask.args[0][0] as SwiftTask;
        expect(task.execution.args).to.deep.equal(["play", "bar"]);
        expect(task.execution.options.cwd).to.equal(folderContext.folder.fsPath);
    });
});
