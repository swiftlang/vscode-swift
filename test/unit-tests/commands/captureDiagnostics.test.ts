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
import * as fs from "fs/promises";
import * as decompress from "decompress";
import { expect } from "chai";
import { instance, MockedObject, mockFn, mockGlobalObject, mockObject } from "../../MockUtils";
import { captureDiagnostics } from "../../../src/commands/captureDiagnostics";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { FolderContext } from "../../../src/FolderContext";
import { Version } from "../../../src/utilities/version";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { SwiftLogger } from "../../../src/logging/SwiftLogger";

suite("captureDiagnostics Test Suite", () => {
    let mockContext: MockedObject<WorkspaceContext>;
    let mockedLogger: MockedObject<SwiftLogger>;
    let mockedToolchain: MockedObject<SwiftToolchain>;
    const mockWindow = mockGlobalObject(vscode, "window");

    setup(() => {
        mockedToolchain = mockObject<SwiftToolchain>({
            swiftVersion: new Version(6, 0, 0),
            diagnostics: "some diagnostics",
        });
        const mockedFolder = mockObject<FolderContext>({
            folder: vscode.Uri.file("/folder1"),
            toolchain: instance(mockedToolchain),
        });
        mockedLogger = mockObject<SwiftLogger>({
            info: mockFn(),
            logs: ["hello", "world"],
        });
        mockContext = mockObject<WorkspaceContext>({
            folders: [instance(mockedFolder)],
            globalToolchainSwiftVersion: new Version(6, 0, 0),
            logger: instance(mockedLogger),
        });
        mockWindow.showInformationMessage.resolves("Minimal" as any);
    });

    test("Should capture dianostics to a zip file", async () => {
        const zipPath = await captureDiagnostics(instance(mockContext));
        expect(zipPath).to.not.be.undefined;
    });

    test("Should validate a single folder project zip file has contents", async () => {
        const zipPath = await captureDiagnostics(instance(mockContext));
        expect(zipPath).to.not.be.undefined;

        const { files, folder } = await decompressZip(zipPath as string);

        validate(
            files.map(file => file.path),
            ["extension-logs.txt", "folder1-[a-z0-9]+-settings.txt"]
        );

        await fs.rm(folder, { recursive: true, force: true });
    });

    suite("Multiple folder project", () => {
        setup(() => {
            const mockedFolder1 = mockObject<FolderContext>({
                folder: vscode.Uri.file("/folder1"),
                toolchain: instance(mockedToolchain),
            });
            const mockedFolder2 = mockObject<FolderContext>({
                folder: vscode.Uri.file("/folder2"),
                toolchain: instance(mockedToolchain),
            });
            mockContext = mockObject<WorkspaceContext>({
                folders: [instance(mockedFolder1), instance(mockedFolder2)],
                globalToolchainSwiftVersion: new Version(6, 0, 0),
                logger: instance(mockedLogger),
            });
            mockWindow.showInformationMessage.resolves("Minimal" as any);
        });

        test("Should validate a multiple folder project zip file has contents", async () => {
            const zipPath = await captureDiagnostics(instance(mockContext));
            expect(zipPath).to.not.be.undefined;

            const { files, folder } = await decompressZip(zipPath as string);
            validate(
                files.map(file => file.path),
                [
                    "extension-logs.txt",
                    "folder1/",
                    "folder1/folder1-[a-z0-9]+-settings.txt",
                    "folder2/",
                    "folder2/folder2-[a-z0-9]+-settings.txt",
                ]
            );
            await fs.rm(folder, { recursive: true, force: true });
        });
    });

    async function decompressZip(
        zipPath: string
    ): Promise<{ folder: string; files: decompress.File[] }> {
        const tempDir = path.join(
            os.tmpdir(),
            `vscode-swift-test-${Math.random().toString(36).substring(7)}`
        );
        await fs.mkdir(tempDir, { recursive: true });
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
