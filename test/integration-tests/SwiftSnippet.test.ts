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
import { realpathSync } from "fs";
import * as vscode from "vscode";

import { WorkspaceContext } from "@src/WorkspaceContext";
import { Commands } from "@src/commands";
import { Version } from "@src/utilities/version";

import { testAssetUri } from "../fixtures";
import { tag } from "../tags";
import { closeAllEditors } from "../utilities/commands";
import {
    continueSession,
    waitForDebugAdapterRequest,
    waitUntilDebugSessionTerminates,
} from "../utilities/debug";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "./utilities/testutilities";

tag("large").suite("SwiftSnippet Test Suite", function () {
    const uri = testAssetUri("defaultPackage/Snippets/hello.swift");
    const breakpoints = [
        new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(2, 0))),
    ];
    let workspaceContext: WorkspaceContext;
    let resetSettings: (() => Promise<void>) | undefined;

    activateExtensionForSuite({
        async setup(api) {
            const ctx = await api.waitForWorkspaceContext();
            workspaceContext = ctx;

            const folder = await folderInRootWorkspace("defaultPackage", workspaceContext);
            if (folder.toolchain.swiftVersion.isLessThan(new Version(5, 10, 0))) {
                this.skip();
            }
            resetSettings = await updateSettings({
                "swift.debugger.debugAdapter": "lldb-dap",
            });

            // File needs to be open for command to be enabled
            await workspaceContext.focusFolder(folder);
            await vscode.window.showTextDocument(uri);

            // Set a breakpoint
            vscode.debug.addBreakpoints(breakpoints);
        },
        requiresDebugger: true,
    });

    suiteTeardown(async () => {
        await closeAllEditors();
        vscode.debug.removeBreakpoints(breakpoints);
        if (resetSettings) {
            await resetSettings();
        }
    });

    test("Run `Swift: Run Swift Snippet` command for snippet file", async () => {
        const sessionPromise = waitUntilDebugSessionTerminates("Run hello");

        const succeeded = await vscode.commands.executeCommand(Commands.RUN_SNIPPET, "hello");

        expect(succeeded).to.be.true;
        const session = await sessionPromise;
        expect(session.configuration.program).to.equalPath(
            realpathSync(
                testAssetUri(
                    "defaultPackage/.build/debug/hello" +
                        (process.platform === "win32" ? ".exe" : "")
                ).fsPath
            )
        );
        expect(session.configuration).to.have.property("noDebug", true);
    });

    test("Run `Swift: Debug Swift Snippet` command for snippet file", async () => {
        const bpPromise = waitForDebugAdapterRequest(
            "Run hello",
            workspaceContext.globalToolchain.swiftVersion,
            "stackTrace"
        );
        const sessionPromise = waitUntilDebugSessionTerminates("Run hello");

        const succeededPromise: Thenable<boolean> = vscode.commands.executeCommand(
            Commands.DEBUG_SNIPPET,
            "hello"
        );

        // Once bp is hit, continue
        await bpPromise;
        let succeeded = false;
        void succeededPromise.then(s => (succeeded = s));
        while (!succeeded) {
            try {
                await continueSession();
            } catch {
                // Ignore
            }
            await new Promise(r => setTimeout(r, 500));
        }

        expect(succeeded).to.be.true;

        const session = await sessionPromise;
        expect(session.configuration.program).to.equalPath(
            realpathSync(
                testAssetUri(
                    "defaultPackage/.build/debug/hello" +
                        (process.platform === "win32" ? ".exe" : "")
                ).fsPath
            )
        );
        expect(session.configuration).to.not.have.property("noDebug");
    });
});
