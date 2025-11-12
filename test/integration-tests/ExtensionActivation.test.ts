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
import * as assert from "assert";
import { expect } from "chai";
import { afterEach } from "mocha";
import * as vscode from "vscode";

import { WorkspaceContext } from "@src/WorkspaceContext";

import { testAssetUri } from "../fixtures";
import { tag } from "../tags";
import { assertContains } from "./testexplorer/utilities";
import {
    activateExtension,
    activateExtensionForSuite,
    activateExtensionForTest,
    deactivateExtension,
} from "./utilities/testutilities";

tag("medium").suite("Extension Activation/Deactivation Tests", () => {
    suite("Extension Activation", () => {
        afterEach(async () => {
            await deactivateExtension();
        });

        async function activate() {
            assert.ok(await activateExtension(), "Extension did not return its API");
            const ext = vscode.extensions.getExtension("swiftlang.swift-vscode");
            assert.ok(ext, "Extension is not found");
            assert.strictEqual(ext.isActive, true);
        }

        test("Activation", async function () {
            await activate();
        });

        test("Duplicate Activation", async function () {
            await activate();
            await expect(activateExtension())
                .to.eventually.be.rejectedWith("The Swift extension has already been activated.")
                .that.has.property("cause");
        });
    });

    test("Deactivation", async function () {
        const api = await activateExtension();
        await deactivateExtension();
        const ext = vscode.extensions.getExtension("swiftlang.swift-vscode");
        assert(ext);
        assert.equal(api.workspaceContext, undefined);
    });

    suite("Extension Activation per suite", () => {
        let workspaceContext: WorkspaceContext | undefined;
        let capturedWorkspaceContext: WorkspaceContext | undefined;
        activateExtensionForSuite({
            async setup(api) {
                const ctx = await api.waitForWorkspaceContext();
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
            async setup(api) {
                const ctx = await api.waitForWorkspaceContext();
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
        let workspaceContext: WorkspaceContext;

        activateExtensionForTest({
            async setup(api) {
                const ctx = await api.waitForWorkspaceContext();
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
