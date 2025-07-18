//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { expect } from "chai";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Commands } from "../../../src/commands";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "../utilities/testutilities";
import { closeAllEditors } from "../../utilities/commands";
import {
    sourcekitConfigFilePath,
    sourcekitFolderPath,
} from "../../../src/commands/generateSourcekitConfiguration";

suite("Generate SourceKit-LSP configuration Command", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;
    let resetSettings: (() => Promise<void>) | undefined;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
            await workspaceContext.focusFolder(folderContext);
        },
    });

    teardown(async () => {
        if (resetSettings) {
            await resetSettings();
        }
        await vscode.workspace.fs.delete(vscode.Uri.file(sourcekitFolderPath(folderContext)), {
            recursive: true,
        });
    });

    suiteTeardown(async () => {
        await closeAllEditors();
    });

    test("Calculates branch based on toolchain", async () => {
        const result = await vscode.commands.executeCommand(Commands.GENERATE_SOURCEKIT_CONFIG);
        expect(result).to.be.true;
        const contents = Buffer.from(
            await vscode.workspace.fs.readFile(
                vscode.Uri.file(sourcekitConfigFilePath(folderContext))
            )
        ).toString("utf-8");
        const config = JSON.parse(contents);
        const version = folderContext.swiftVersion;
        const branch = version.dev ? "main" : `release/${version.major}.${version.minor}`;
        expect(config).to.have.property(
            "$schema",
            `https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/${branch}/config.schema.json`
        );
    });

    test("Uses hardcoded path", async () => {
        resetSettings = await updateSettings({
            "swift.sourcekit-lsp.configurationBranch": "release/6.1",
        });
        const result = await vscode.commands.executeCommand(Commands.GENERATE_SOURCEKIT_CONFIG);
        expect(result).to.be.true;
        const contents = Buffer.from(
            await vscode.workspace.fs.readFile(
                vscode.Uri.file(sourcekitConfigFilePath(folderContext))
            )
        ).toString("utf-8");
        const config = JSON.parse(contents);
        expect(config).to.have.property(
            "$schema",
            `https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/release/6.1/config.schema.json`
        );
    });

    test('Fallsback to "main" when path does not exist', async () => {
        resetSettings = await updateSettings({
            "swift.sourcekit-lsp.configurationBranch": "totally-invalid-branch",
        });
        const result = await vscode.commands.executeCommand(Commands.GENERATE_SOURCEKIT_CONFIG);
        expect(result).to.be.true;
        const contents = Buffer.from(
            await vscode.workspace.fs.readFile(
                vscode.Uri.file(sourcekitConfigFilePath(folderContext))
            )
        ).toString("utf-8");
        const config = JSON.parse(contents);
        expect(config).to.have.property(
            "$schema",
            `https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/main/config.schema.json`
        );
    });
});
