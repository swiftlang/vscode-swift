//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2022 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as assert from "assert";
import { afterEach } from "mocha";
import {
    activateExtension,
    activateExtensionForSuite,
    activateExtensionForTest,
    deactivateExtension,
} from "./utilities/testutilities";
import { WorkspaceContext } from "../../src/WorkspaceContext";
import { testAssetUri } from "../fixtures";
import { assertContains } from "./testexplorer/utilities";

suite("Extension Activation/Deactivation Tests", () => {
    suite("Extension Activation", () => {
        afterEach(async () => {
            await deactivateExtension();
        });

        async function activate(currentTest?: Mocha.Test) {
            assert.ok(await activateExtension(currentTest), "Extension did not return its API");
            const ext = vscode.extensions.getExtension("swiftlang.swift-vscode");
            assert.ok(ext, "Extension is not found");
            assert.strictEqual(ext.isActive, true);
        }

        test("Activation", async function () {
            await activate(this.test as Mocha.Test);
        });

        test("Duplicate Activation", async function () {
            await activate(this.test as Mocha.Test);
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            assert.rejects(activateExtension(this.test as Mocha.Test), err => {
                const msg = (err as unknown as any).message;
                return (
                    msg.includes("Extension is already activated") &&
                    msg.includes((this.test as Mocha.Test)?.titlePath().join(" → "))
                );
            });
        });
    });

    test("Deactivation", async function () {
        const workspaceContext = await activateExtension(this.test as Mocha.Test);
        await deactivateExtension();
        const ext = vscode.extensions.getExtension("swiftlang.swift-vscode");
        assert(ext);
        assert.equal(workspaceContext.subscriptions.length, 0);
    });

    suite("Extension Activation per suite", () => {
        let workspaceContext: WorkspaceContext | undefined;
        let capturedWorkspaceContext: WorkspaceContext | undefined;
        activateExtensionForSuite({
            async setup(ctx) {
                workspaceContext = ctx;
            },
        });

        test("Assert workspace context is created", () => {
            assert.ok(workspaceContext);
            capturedWorkspaceContext = workspaceContext;
        });

        test("Assert workspace context is not recreated", () => {
            assert.strictEqual(workspaceContext, capturedWorkspaceContext);
        });
    });

    suite("Extension activation per test", () => {
        let workspaceContext: WorkspaceContext | undefined;
        let capturedWorkspaceContext: WorkspaceContext | undefined;
        activateExtensionForTest({
            async setup(ctx) {
                workspaceContext = ctx;
            },
        });

        test("Assert workspace context is created", () => {
            assert.ok(workspaceContext);
            capturedWorkspaceContext = workspaceContext;
        });

        test("Assert workspace context is recreated per test", () => {
            assert.notStrictEqual(workspaceContext, capturedWorkspaceContext);
        });
    });

    suite("Activates for cmake projects", function () {
        this.timeout(60000);

        let workspaceContext: WorkspaceContext;

        activateExtensionForTest({
            async setup(ctx) {
                workspaceContext = ctx;
            },
            testAssets: ["cmake", "cmake-compile-flags"],
        });

        test("compile_commands.json", async () => {
            const folder = workspaceContext.folders[0];
            assert(folder);

            const languageClient = workspaceContext.languageClientManager.get(folder);
            const lspWorkspaces = languageClient.subFolderWorkspaces.map(
                ({ folder }) => folder.fsPath
            );
            assertContains(lspWorkspaces, testAssetUri("cmake").fsPath);
        });

        test("compile_flags.txt", async () => {
            const folder = workspaceContext.folders[0];
            assert(folder);

            const languageClient = workspaceContext.languageClientManager.get(folder);
            const lspWorkspaces = languageClient.subFolderWorkspaces.map(
                ({ folder }) => folder.fsPath
            );
            assertContains(lspWorkspaces, testAssetUri("cmake-compile-flags").fsPath);
        });
    });
});
