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
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { Commands } from "@src/commands";
import { Version } from "@src/utilities/version";

import { testAssetUri } from "../../fixtures";
import { tag } from "../../tags";
import { continueSession, waitForDebugAdapterRequest } from "../../utilities/debug";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

tag("large").suite("Build Commands", function () {
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
                ctx.globalToolchain.swiftVersion.isLessThan(new Version(5, 10, 0))
            ) {
                this.skip();
            }
            // A breakpoint will have not effect on the Run command.
            vscode.debug.addBreakpoints(breakpoints);

            workspaceContext = ctx;
            folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
            await workspaceContext.focusFolder(folderContext);
        },
        requiresDebugger: true,
    });

    suiteTeardown(async () => {
        vscode.debug.removeBreakpoints(breakpoints);
    });

    test("Swift: Run Build", async () => {
        const result = await vscode.commands.executeCommand(Commands.RUN, "PackageExe");
        expect(result).to.be.true;
    });

    test("Swift: Debug Build", async function () {
        // This is failing in CI only in Linux 5.10 by crashing VS Code with the error
        // `CodeWindow: renderer process gone (reason: crashed, code: 133)`
        if (
            folderContext.swiftVersion.isGreaterThanOrEqual(new Version(5, 10, 0)) &&
            folderContext.swiftVersion.isLessThan(new Version(6, 0, 0))
        ) {
            this.skip();
        }
        // Promise used to indicate we hit the break point.
        // NB: "stopped" is the exact command when debuggee has stopped due to break point,
        // but "stackTrace" is the deterministic sync point we will use to make sure we can execute continue
        const bpPromise = waitForDebugAdapterRequest(
            "Debug PackageExe (defaultPackage)" +
                (vscode.workspace.workspaceFile ? " (workspace)" : ""),
            workspaceContext.globalToolchain.swiftVersion,
            "stackTrace"
        );

        const resultPromise: Thenable<boolean> = vscode.commands.executeCommand(
            Commands.DEBUG,
            "PackageExe"
        );

        await bpPromise;
        let succeeded = false;
        void resultPromise.then(s => (succeeded = s));
        while (!succeeded) {
            await continueSession();
            await new Promise(r => setTimeout(r, 500));
        }
        await expect(resultPromise).to.eventually.be.true;
    });

    test("Swift: Clean Build", async () => {
        let result = await vscode.commands.executeCommand(Commands.RUN, "PackageExe");
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
});
