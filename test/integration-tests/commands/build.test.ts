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
import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import { folderContextPromise, globalWorkspaceContextPromise } from "../extension.test";
import { waitForNoRunningTasks } from "../../utilities";
import { testAssetUri } from "../../fixtures";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Commands } from "../../../src/commands";
import { makeDebugConfigurations } from "../../../src/debugger/launch";

suite("Build Commands", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;
    const uri = testAssetUri("defaultPackage/Sources/PackageExe/main.swift");
    const breakpoints = [
        new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(2, 0))),
    ];

    suiteSetup(async function () {
        workspaceContext = await globalWorkspaceContextPromise;
        await waitForNoRunningTasks();
        folderContext = await folderContextPromise("defaultPackage");
        await workspaceContext.focusFolder(folderContext);
        await vscode.window.showTextDocument(uri);
        makeDebugConfigurations(folderContext, undefined, true);
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });

    test("Swift: Run Build", async () => {
        // A breakpoint will have not effect on the Run command.
        vscode.debug.addBreakpoints(breakpoints);

        const result = await vscode.commands.executeCommand(Commands.RUN);
        expect(result).to.be.true;

        vscode.debug.removeBreakpoints(breakpoints);
    });

    test("Swift: Clean Build", async () => {
        const buildPath = path.join(folderContext.folder.fsPath, ".build");
        const beforeItemCount = fs.readdirSync(buildPath).length;

        const result = await vscode.commands.executeCommand(Commands.CLEAN_BUILD);
        expect(result).to.be.true;

        const afterItemCount = fs.readdirSync(buildPath).length;
        expect(afterItemCount).to.be.lessThan(beforeItemCount);
    });

    test("Swift: Debug Build", async () => {
        vscode.debug.addBreakpoints(breakpoints);

        const result = vscode.commands.executeCommand(Commands.DEBUG);
        expect(result).to.eventually.be.true;

        await vscode.commands.executeCommand("workbench.action.debug.continue");
        vscode.debug.removeBreakpoints(breakpoints);
    });
});
