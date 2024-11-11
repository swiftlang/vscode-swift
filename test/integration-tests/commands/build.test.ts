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
import { waitForNoRunningTasks } from "../../utilities";
import { testAssetUri } from "../../fixtures";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Commands } from "../../../src/commands";
import { makeDebugConfigurations } from "../../../src/debugger/launch";
import { Workbench } from "../../../src/utilities/commands";
import { continueSession, waitForDebugAdapterCommand } from "../../utilities/debug";
import {
    activateExtension,
    deactivateExtension,
    folderInRootWorkspace,
    updateSettings,
} from "../utilities/testutilities";

suite("Build Commands", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;
    let settingsTeardown: () => Promise<void>;
    const uri = testAssetUri("defaultPackage/Sources/PackageExe/main.swift");
    const breakpoints = [
        new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(2, 0))),
    ];

    suiteSetup(async function () {
        workspaceContext = await activateExtension();
        await waitForNoRunningTasks();
        folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
        await workspaceContext.focusFolder(folderContext);
        await vscode.window.showTextDocument(uri);
        settingsTeardown = await updateSettings({
            "swift.autoGenerateLaunchConfigurations": true,
        });
        await makeDebugConfigurations(folderContext, undefined, true);
    });

    suiteTeardown(async () => {
        await settingsTeardown();
        await vscode.commands.executeCommand(Workbench.ACTION_CLOSEALLEDITORS);
        await deactivateExtension();
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
        // This test will run in order after the Swift: Run Build test,
        // where .build folder is going to be filled with built artifacts.
        // After executing the clean command the build directory is guranteed to have less entry.
        expect(afterItemCount).to.be.lessThan(beforeItemCount);
    });

    test("Swift: Debug Build @slow", async () => {
        vscode.debug.addBreakpoints(breakpoints);
        // Promise used to indicate we hit the break point.
        // NB: "stopped" is the exact command when debuggee has stopped due to break point,
        // but "stackTrace" is the deterministic sync point we will use to make sure we can execute continue
        const bpPromise = waitForDebugAdapterCommand(
            "Debug PackageExe (defaultPackage)",
            "stackTrace",
            workspaceContext
        );

        const result = vscode.commands.executeCommand(Commands.DEBUG);
        expect(result).to.eventually.be.true;

        await bpPromise.then(() => continueSession());
        vscode.debug.removeBreakpoints(breakpoints);
    });
});
