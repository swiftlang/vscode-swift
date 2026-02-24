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
import * as vscode from "vscode";

import { Version } from "@src/utilities/version";
import { searchForPackages } from "@src/utilities/workspace";

import { testAssetUri } from "../../fixtures";

suite("Workspace Utilities Unit Test Suite", () => {
    suite("searchForPackages", () => {
        const packageFolder = testAssetUri("ModularPackage");
        const firstModuleFolder = vscode.Uri.joinPath(packageFolder, "Module1");
        const secondModuleFolder = vscode.Uri.joinPath(packageFolder, "Module2");
        const testSwiftVersion = new Version(5, 9, 0);

        test("returns only root package when search for subpackages disabled", async () => {
            const folders = await searchForPackages(
                packageFolder,
                false,
                false,
                [],
                testSwiftVersion
            );

            expect(folders.map(folder => folder.fsPath)).deep.equal([packageFolder.fsPath]);
        });

        test("returns subpackages when search for subpackages enabled", async () => {
            const folders = await searchForPackages(
                packageFolder,
                false,
                true,
                [],
                testSwiftVersion
            );

            expect(
                folders.map(folder => folder.fsPath).sort((a, b) => a.localeCompare(b))
            ).deep.equal([
                packageFolder.fsPath,
                firstModuleFolder.fsPath,
                secondModuleFolder.fsPath,
            ]);
        });

        test("skips specified folders when skipFolders contains Module1", async () => {
            const folders = await searchForPackages(
                packageFolder,
                false,
                true,
                ["Module1"],
                testSwiftVersion
            );

            expect(
                folders.map(folder => folder.fsPath).sort((a, b) => a.localeCompare(b))
            ).deep.equal([packageFolder.fsPath, secondModuleFolder.fsPath]);
        });

        test("skips specified folders when skipFolders contains Module2", async () => {
            const folders = await searchForPackages(
                packageFolder,
                false,
                true,
                ["Module2"],
                testSwiftVersion
            );

            expect(
                folders.map(folder => folder.fsPath).sort((a, b) => a.localeCompare(b))
            ).deep.equal([packageFolder.fsPath, firstModuleFolder.fsPath]);
        });

        test("skips multiple folders when skipFolders contains both modules", async () => {
            const folders = await searchForPackages(
                packageFolder,
                false,
                true,
                ["Module1", "Module2"],
                testSwiftVersion
            );

            expect(folders.map(folder => folder.fsPath)).deep.equal([packageFolder.fsPath]);
        });

        test("skipFolders has no effect when search for subpackages is disabled", async () => {
            const folders = await searchForPackages(
                packageFolder,
                false,
                false,
                ["Module1", "Module2"],
                testSwiftVersion
            );

            expect(folders.map(folder => folder.fsPath)).deep.equal([packageFolder.fsPath]);
        });

        test("skipFolders with non-existent folder names does not affect results", async () => {
            const folders = await searchForPackages(
                packageFolder,
                false,
                true,
                ["NonExistentModule", "AnotherFakeModule"],
                testSwiftVersion
            );

            expect(
                folders.map(folder => folder.fsPath).sort((a, b) => a.localeCompare(b))
            ).deep.equal([
                packageFolder.fsPath,
                firstModuleFolder.fsPath,
                secondModuleFolder.fsPath,
            ]);
        });
    });
});
