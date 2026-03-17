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
import * as mockFS from "mock-fs";
import * as vscode from "vscode";

import { Version } from "@src/utilities/version";
import { isValidWorkspaceFolder, searchForPackages } from "@src/utilities/workspace";

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

    suite("isValidWorkspaceFolder", () => {
        const testSwiftVersion = new Version(5, 9, 0);

        teardown(() => {
            mockFS.restore();
        });

        test("returns true for folder with Package.swift", async () => {
            mockFS({ "/project/Package.swift": "" });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.true;
        });

        test("returns false for folder with Package.swift when SwiftPM integration disabled", async () => {
            mockFS({ "/project/Package.swift": "" });
            expect(await isValidWorkspaceFolder("/project", true, testSwiftVersion)).to.be.false;
        });

        test("returns true for folder with compile_commands.json", async () => {
            mockFS({ "/project/compile_commands.json": "[]" });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.true;
        });

        test("returns true for folder with compile_flags.txt", async () => {
            mockFS({ "/project/compile_flags.txt": "" });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.true;
        });

        test("returns true for folder with compile_commands.json inside build/", async () => {
            mockFS({ "/project/build/compile_commands.json": "[]" });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.true;
        });

        test("returns true for folder with compile_commands.json inside out/", async () => {
            mockFS({ "/project/out/compile_commands.json": "[]" });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.true;
        });

        test("returns false for folder with only a build/ directory", async () => {
            mockFS({ "/project/build": {} });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.false;
        });

        test("returns false for folder with only an out/ directory", async () => {
            mockFS({ "/project/out": {} });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.false;
        });

        test("returns false for empty folder", async () => {
            mockFS({ "/project": {} });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.false;
        });

        test("returns true for folder with buildServer.json", async () => {
            mockFS({ "/project/buildServer.json": "{}" });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.true;
        });

        test("returns false for Flutter project with only build/ and pubspec.yaml", async () => {
            mockFS({
                "/flutter-project/pubspec.yaml": "name: my_app",
                "/flutter-project/build": {},
                "/flutter-project/lib/main.dart": "",
            });
            expect(await isValidWorkspaceFolder("/flutter-project", false, testSwiftVersion)).to.be
                .false;
        });

        test("returns true for folder with .bsp directory containing JSON on Swift >= 6.1", async () => {
            mockFS({
                "/project/.bsp/server.json": "{}",
            });
            const swift61 = new Version(6, 1, 0);
            expect(await isValidWorkspaceFolder("/project", false, swift61)).to.be.true;
        });

        test("returns false for folder with .bsp directory on Swift < 6.1", async () => {
            mockFS({
                "/project/.bsp/server.json": "{}",
            });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.false;
        });

        test("returns false for build/ with other files but no compile_commands.json", async () => {
            mockFS({
                "/project/build/output.o": "",
                "/project/build/Makefile": "",
            });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.false;
        });

        test("returns true for folder with both Package.swift and build/compile_commands.json", async () => {
            mockFS({
                "/project/Package.swift": "",
                "/project/build/compile_commands.json": "[]",
            });
            expect(await isValidWorkspaceFolder("/project", false, testSwiftVersion)).to.be.true;
        });
    });
});
