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
import * as path from "path";
import * as os from "os";
import { mkdir, rm } from "fs/promises";
import * as decompress from "decompress";
import { expect } from "chai";
import { captureDiagnostics } from "../../../src/commands/captureDiagnostics";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { mockGlobalObject } from "../../MockUtils";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

suite("captureDiagnostics Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    const mockWindow = mockGlobalObject(vscode, "window");

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
        },
        testAssets: ["defaultPackage"],
    });

    setup(() => {
        mockWindow.showInformationMessage.resolves("Minimal" as any);
    });

    test("Should capture dianostics to a zip file", async () => {
        const zipPath = await captureDiagnostics(workspaceContext);
        expect(zipPath).to.not.be.undefined;
    });

    test("Should validate a single folder project zip file has contents", async () => {
        const zipPath = await captureDiagnostics(workspaceContext);
        expect(zipPath).to.not.be.undefined;

        const { files, folder } = await decompressZip(zipPath as string);

        validate(
            files.map(file => file.path),
            ["swift-vscode-extension.log", "defaultPackage-[a-z0-9]+-settings.txt"]
        );

        await rm(folder, { recursive: true, force: true });
    });

    suite("Multiple folder project", () => {
        setup(async () => {
            await folderInRootWorkspace("dependencies", workspaceContext);
        });

        test("Should validate a multiple folder project zip file has contents", async () => {
            const zipPath = await captureDiagnostics(workspaceContext);
            expect(zipPath).to.not.be.undefined;

            const { files, folder } = await decompressZip(zipPath as string);
            validate(
                files.map(file => file.path),
                [
                    "swift-vscode-extension.log",
                    "defaultPackage/",
                    "defaultPackage/defaultPackage-[a-z0-9]+-settings.txt",
                    "dependencies/",
                    "dependencies/dependencies-[a-z0-9]+-settings.txt",
                ]
            );
            await rm(folder, { recursive: true, force: true });
        });
    });

    async function decompressZip(
        zipPath: string
    ): Promise<{ folder: string; files: decompress.File[] }> {
        const tempDir = path.join(
            os.tmpdir(),
            `vscode-swift-test-${Math.random().toString(36).substring(7)}`
        );
        await mkdir(tempDir, { recursive: true });
        return { folder: tempDir, files: await decompress(zipPath as string, tempDir) };
    }

    function validate(paths: string[], patterns: string[]): void {
        expect(paths.length).to.equal(
            patterns.length,
            `Expected ${patterns.length} files, but found ${paths.length}`
        );
        const regexes = patterns.map(pattern => new RegExp(`^${pattern}$`));
        for (const regex of regexes) {
            const matched = paths.some(path => regex.test(path));
            expect(matched, `No path matches the pattern: ${regex}, got paths: ${paths}`).to.be
                .true;
        }
    }
});
