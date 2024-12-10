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
import { testAssetPath, testAssetUri } from "../fixtures";
import { waitForNoRunningTasks } from "../utilities/tasks";
import { expect } from "chai";
import {
    continueSession,
    waitForDebugAdapterRequest,
    waitForDebugAdapterExit,
    waitUntilDebugSessionTerminates,
} from "../utilities/debug";
import { Version } from "../../src/utilities/version";
import { activateExtensionForSuite, folderInRootWorkspace } from "./utilities/testutilities";
import { WorkspaceContext } from "../../src/WorkspaceContext";
import { join } from "path";

suite("SwiftSnippet Test Suite", function () {
    this.timeout(120000);

    const uri = testAssetUri("defaultPackage/Snippets/hello.swift");
    const breakpoints = [
        new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(2, 0))),
    ];
    let workspaceContext: WorkspaceContext;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;

            const folder = await folderInRootWorkspace("defaultPackage", workspaceContext);
            if (folder.workspaceContext.toolchain.swiftVersion.isLessThan(new Version(6, 0, 0))) {
                this.skip();
            }
            await waitForNoRunningTasks();

            // File needs to be open for command to be enabled
            const doc = await vscode.workspace.openTextDocument(uri.fsPath);
            await vscode.window.showTextDocument(doc);

            // Set a breakpoint
            vscode.debug.addBreakpoints(breakpoints);
        },
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        vscode.debug.removeBreakpoints(breakpoints);
    });

    test("Run `Swift: Run Swift Snippet` command for snippet file", async () => {
        const sessionPromise = waitUntilDebugSessionTerminates("Run hello");
        const exitPromise = waitForDebugAdapterExit("Run hello");

        await vscode.commands.executeCommand("swift.runSnippet");

        const exitCode = await exitPromise;
        expect(exitCode).to.equal(0);

        const session = await sessionPromise;
        let path = join(testAssetPath("defaultPackage"), ".build", "debug", "hello");
        if (process.platform === "win32") {
            path = path + ".exe";
        }
        expect(session.configuration.program?.toLowerCase()).to.equal(
            path.toLocaleLowerCase() // Windows may use d:\ or D:\
        );
        expect(session.configuration).to.have.property("noDebug", true);
    });

    test("Run `Swift: Debug Swift Snippet` command for snippet file", async () => {
        const bpPromise = waitForDebugAdapterRequest("Run hello", "stackTrace");
        const sessionPromise = waitUntilDebugSessionTerminates("Run hello");
        const exitPromise = waitForDebugAdapterExit("Run hello");

        vscode.commands.executeCommand("swift.debugSnippet");

        // Once bp is hit, continue
        await bpPromise.then(() => continueSession());

        const exitCode = await exitPromise;
        expect(exitCode).to.equal(0);

        const session = await sessionPromise;
        let path = join(testAssetPath("defaultPackage"), ".build", "debug", "hello");
        if (process.platform === "win32") {
            path = path + ".exe";
        }
        expect(session.configuration.program?.toLowerCase()).to.equal(
            path.toLocaleLowerCase() // Windows may use d:\ or D:\
        );
        expect(session.configuration).to.not.have.property("noDebug");
    });
});
