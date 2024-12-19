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
import { waitForNoRunningTasks } from "../../utilities/tasks";
import { testAssetUri } from "../../fixtures";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Commands } from "../../../src/commands";
import { Workbench } from "../../../src/utilities/commands";
import { continueSession, waitForDebugAdapterRequest } from "../../utilities/debug";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";
import { Version } from "../../../src/utilities/version";

suite("Build Commands @slow", function () {
    // Default timeout is a bit too short, give it a little bit more time
    this.timeout(2 * 60 * 1000);

    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;
    const uri = testAssetUri("defaultPackage/Sources/PackageExe/main.swift");
    const breakpoints = [
        new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(2, 0))),
    ];

    activateExtensionForSuite({
        async setup(ctx) {
            // The description of this package is crashing on Windows with Swift 5.9.x and below
            if (
                process.platform === "win32" &&
                ctx.toolchain.swiftVersion.isLessThanOrEqual(new Version(5, 9, 0))
            ) {
                this.skip();
            }

            workspaceContext = ctx;
            await waitForNoRunningTasks();
            folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
            await workspaceContext.focusFolder(folderContext);
            await vscode.window.showTextDocument(uri);
        },
        async teardown() {
            await vscode.commands.executeCommand(Workbench.ACTION_CLOSEALLEDITORS);
        },
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

        const buildPath = path.join(folderContext.folder.fsPath, ".build");
        const beforeItemCount = (await fs.readdir(buildPath)).length;

        result = await vscode.commands.executeCommand(Commands.CLEAN_BUILD);
        expect(result).to.be.true;

        const afterItemCount = (await fs.readdir(buildPath)).length;
        // .build folder is going to be filled with built artifacts after Commands.RUN command
        // After executing the clean command the build directory is guranteed to have less entry.
        expect(afterItemCount).to.be.lessThan(beforeItemCount);
    });

    test("Swift: Debug Build", async () => {
        vscode.debug.addBreakpoints(breakpoints);
        // Promise used to indicate we hit the break point.
        // NB: "stopped" is the exact command when debuggee has stopped due to break point,
        // but "stackTrace" is the deterministic sync point we will use to make sure we can execute continue
        const bpPromise = waitForDebugAdapterRequest(
            "Debug PackageExe (defaultPackage)",
            workspaceContext.toolchain.swiftVersion,
            "stackTrace"
        );

        const result = vscode.commands.executeCommand(Commands.DEBUG);
        expect(result).to.eventually.be.true;

        await bpPromise;
        await continueSession();

        vscode.debug.removeBreakpoints(breakpoints);
    });
});
