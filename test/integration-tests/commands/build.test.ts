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
import * as fs from "fs/promises";
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
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "../utilities/testutilities";
import { pathExists } from "../../../src/utilities/filesystem";

suite("Build Commands", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;
    let buildPath: string;
    const uri = testAssetUri("defaultPackage/Sources/PackageExe/main.swift");
    const breakpoints = [
        new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(2, 0))),
    ];

    activateExtensionForSuite({
        async setup(ctx) {
            // The description of this package is crashing on Windows with Swift 5.9.x and below,
            // preventing it from being built. The cleanup in the teardown is failng as well with
            // an EBUSY error. Skip this test on Windows until the issue is resolved.
            if (process.platform === "win32") {
                this.skip();
            }

            workspaceContext = ctx;
            await waitForNoRunningTasks();
            folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
            buildPath = path.join(folderContext.folder.fsPath, ".build");
            await workspaceContext.focusFolder(folderContext);
            await vscode.window.showTextDocument(uri);
            const settingsTeardown = await updateSettings({
                "swift.autoGenerateLaunchConfigurations": true,
            });
            await makeDebugConfigurations(folderContext, undefined, true);
            return settingsTeardown;
        },
        async teardown() {
            await vscode.commands.executeCommand(Workbench.ACTION_CLOSEALLEDITORS);
        },
    });

    teardown(async () => {
        // Remove the build directory after each test case
        if (await pathExists(buildPath)) {
            await fs.rm(buildPath, { recursive: true, force: true });
        }
    });

    test("Swift: Run Build", async () => {
        // A breakpoint will have not effect on the Run command.
        vscode.debug.addBreakpoints(breakpoints);

        const result = await vscode.commands.executeCommand(Commands.RUN);
        expect(result).to.be.true;

        vscode.debug.removeBreakpoints(breakpoints);
    });

    test("Swift: Clean Build", async () => {
        let result = await vscode.commands.executeCommand(Commands.RUN);
        expect(result).to.be.true;

        const beforeItemCount = (await fs.readdir(buildPath)).length;

        result = await vscode.commands.executeCommand(Commands.CLEAN_BUILD);
        expect(result).to.be.true;

        const afterItemCount = (await fs.readdir(buildPath)).length;
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
