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
import { stub } from "sinon";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { Commands } from "@src/commands";
import { runPlayground } from "@src/commands/runPlayground";
import { Playground } from "@src/sourcekit-lsp/extensions";
import { SwiftTask } from "@src/tasks/SwiftTaskProvider";
import { TaskManager } from "@src/tasks/TaskManager";
import { PlaygroundNode } from "@src/ui/ProjectPanelProvider";

import { MockedObject, instance, mockObject } from "../../MockUtils";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

suite("Run Playground Command", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;
    let mockTaskManager: MockedObject<TaskManager>;

    activateExtensionForSuite({
        async setup(api) {
            workspaceContext = await api.waitForWorkspaceContext();
            folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
        },
    });

    setup(async () => {
        await workspaceContext.focusFolder(folderContext);
        mockTaskManager = mockObject<TaskManager>({ executeTaskAndWait: stub().resolves() });
    });

    suite("Command", () => {
        test("Succeeds with PlaygroundItem", async () => {
            expect(
                await vscode.commands.executeCommand(Commands.PLAY, {
                    id: "PackageLib/PackageLib.swift:3",
                })
            ).to.be.true;
        });

        test("Succeeds with PlaygroundNode", async () => {
            expect(
                await vscode.commands.executeCommand(
                    Commands.PLAY,
                    new PlaygroundNode(
                        {
                            label: "foo",
                            id: "PackageLib/PackageLib.swift:3",
                        } as Playground,
                        folderContext,
                        new Set()
                    )
                )
            ).to.be.true;
        });

        test("No playground item provided", async () => {
            expect(await vscode.commands.executeCommand(Commands.PLAY), undefined).to.be.false;
        });

        test("No folder focussed", async () => {
            await workspaceContext.focusFolder(null);
            expect(
                await vscode.commands.executeCommand(Commands.PLAY, {
                    id: "PackageLib/PackageLib.swift:3",
                })
            ).to.be.false;
        });
    });

    suite("Arguments", () => {
        test('Runs "swift play" on "id"', async () => {
            expect(
                await runPlayground(folderContext, instance(mockTaskManager), {
                    id: "PackageLib/PackageLib.swift:3",
                })
            ).to.be.true;
            expect(mockTaskManager.executeTaskAndWait).to.have.been.calledOnce;

            const task = mockTaskManager.executeTaskAndWait.args[0][0] as SwiftTask;
            expect(task.execution.args).to.deep.equal(["play", "PackageLib/PackageLib.swift:3"]);
            expect(task.execution.options.cwd).to.equal(folderContext.folder.fsPath);
        });

        test('Runs "swift play" on "id" with space in path', async () => {
            expect(
                await runPlayground(folderContext, instance(mockTaskManager), {
                    id: "PackageLib/Package Lib.swift:3",
                })
            ).to.be.true;
            expect(mockTaskManager.executeTaskAndWait).to.have.been.calledOnce;

            const task = mockTaskManager.executeTaskAndWait.args[0][0] as SwiftTask;
            expect(task.execution.args).to.deep.equal(["play", "PackageLib/Package Lib.swift:3"]);
            expect(task.execution.options.cwd).to.equal(folderContext.folder.fsPath);
        });

        test('Runs "swift play" on "label"', async () => {
            expect(
                await runPlayground(folderContext, instance(mockTaskManager), {
                    id: "PackageLib/PackageLib.swift:3",
                    label: "bar",
                })
            ).to.be.true;
            expect(mockTaskManager.executeTaskAndWait).to.have.been.calledOnce;

            const task = mockTaskManager.executeTaskAndWait.args[0][0] as SwiftTask;
            expect(task.execution.args).to.deep.equal(["play", "bar"]);
            expect(task.execution.options.cwd).to.equal(folderContext.folder.fsPath);
        });
    });
});
