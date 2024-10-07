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
import { folderContextPromise } from "./extension.test";
import { testAssetPath, testAssetUri } from "../fixtures";
import { waitForNoRunningTasks } from "../utilities/tasks";
import { expect } from "chai";
import {
    continueSession,
    waitForDebugAdapterCommand,
    waitForDebugAdapterExit,
    waitUntilDebugSessionTerminates,
} from "../utilities/debug";

suite("SwiftSnippet Test Suite", () => {
    const uri = testAssetUri("defaultPackage/Snippets/hello.swift");
    const breakpoints = [
        new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(2, 0))),
    ];

    suiteSetup(async () => {
        await folderContextPromise("defaultPackage");
        await waitForNoRunningTasks();

        // File needs to be open for command to be enabled
        const doc = await vscode.workspace.openTextDocument(uri.fsPath);
        await vscode.window.showTextDocument(doc);

        // Set a breakpoint
        vscode.debug.addBreakpoints(breakpoints);
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
        expect(session.configuration).to.have.property(
            "program",
            `${testAssetPath("defaultPackage")}/.build/debug/hello`
        );
        expect(session.configuration).to.have.property("noDebug", true);
    }).timeout(120000);

    test("Run `Swift: Debug Swift Snippet` command for snippet file", async () => {
        const bpPromise = waitForDebugAdapterCommand("Run hello", "stackTrace");
        const sessionPromise = waitUntilDebugSessionTerminates("Run hello");
        const exitPromise = waitForDebugAdapterExit("Run hello");

        vscode.commands.executeCommand("swift.debugSnippet");

        // Once bp is hit, continue
        await bpPromise.then(() => continueSession());

        const exitCode = await exitPromise;
        expect(exitCode).to.equal(0);

        const session = await sessionPromise;
        expect(session.configuration).to.have.property(
            "program",
            `${testAssetPath("defaultPackage")}/.build/debug/hello`
        );
        expect(session.configuration).to.not.have.property("noDebug");
    }).timeout(120000);
});
