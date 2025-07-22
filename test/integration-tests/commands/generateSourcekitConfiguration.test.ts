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
    determineSchemaURL,
    handleSchemaUpdate,
    sourcekitConfigFilePath,
    sourcekitFolderPath,
} from "../../../src/commands/generateSourcekitConfiguration";
import { Version } from "../../../src/utilities/version";
import { mockGlobalObject } from "../../MockUtils";

suite("Generate SourceKit-LSP configuration Command", function () {
    let folderContext: FolderContext;
    let configFileUri: vscode.Uri;
    let workspaceContext: WorkspaceContext;
    let resetSettings: (() => Promise<void>) | undefined;

    async function getSchema() {
        const contents = Buffer.from(await vscode.workspace.fs.readFile(configFileUri)).toString(
            "utf-8"
        );
        return JSON.parse(contents);
    }

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
            configFileUri = vscode.Uri.file(sourcekitConfigFilePath(folderContext));
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
        const config = await getSchema();
        const version = folderContext.swiftVersion;
        let branch: string;
        if (folderContext.swiftVersion.isGreaterThanOrEqual(new Version(6, 1, 0))) {
            branch = version.dev ? "main" : `release/${version.major}.${version.minor}`;
        } else {
            branch = "main";
        }
        expect(config).to.have.property(
            "$schema",
            `https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/${branch}/config.schema.json`
        );
    });

    test("Uses hardcoded path", async () => {
        resetSettings = await updateSettings({
            "swift.lspConfigurationBranch": "release/6.1",
        });
        const result = await vscode.commands.executeCommand(Commands.GENERATE_SOURCEKIT_CONFIG);
        expect(result).to.be.true;
        const config = await getSchema();
        expect(config).to.have.property(
            "$schema",
            `https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/release/6.1/config.schema.json`
        );
    });

    test('Fallsback to "main" when path does not exist', async () => {
        resetSettings = await updateSettings({
            "swift.lspConfigurationBranch": "totally-invalid-branch",
        });
        const result = await vscode.commands.executeCommand(Commands.GENERATE_SOURCEKIT_CONFIG);
        expect(result).to.be.true;
        const config = await getSchema();
        expect(config).to.have.property(
            "$schema",
            `https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/main/config.schema.json`
        );
    });

    suite("handleSchemaUpdate", async () => {
        const mockWindow = mockGlobalObject(vscode, "window");

        test("Updates to new schema version", async () => {
            await vscode.workspace.fs.writeFile(
                configFileUri,
                Buffer.from(
                    JSON.stringify({
                        $schema:
                            "https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/main/config.schema.json",
                    })
                )
            );
            mockWindow.showInformationMessage.resolves("Yes" as any);
            const document = await vscode.workspace.openTextDocument(configFileUri);

            await handleSchemaUpdate(document, workspaceContext);

            const config = await getSchema();
            const version = folderContext.swiftVersion;
            let branch: string;
            if (folderContext.swiftVersion.isGreaterThanOrEqual(new Version(6, 1, 0))) {
                branch = version.dev ? "main" : `release/${version.major}.${version.minor}`;
            } else {
                branch = "main";
            }
            expect(config).to.have.property(
                "$schema",
                `https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/${branch}/config.schema.json`
            );
        });

        test("Schema version still the same", async () => {
            await vscode.workspace.fs.writeFile(
                configFileUri,
                Buffer.from(
                    JSON.stringify({
                        $schema: await determineSchemaURL(folderContext),
                    })
                )
            );
            mockWindow.showInformationMessage.resolves("Yes" as any);
            const document = await vscode.workspace.openTextDocument(configFileUri);

            await handleSchemaUpdate(document, workspaceContext);

            expect(mockWindow.showInformationMessage).to.have.not.been.called;
        });

        test("Don't update schema version", async () => {
            await vscode.workspace.fs.writeFile(
                configFileUri,
                Buffer.from(
                    JSON.stringify({
                        $schema:
                            "https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/main/config.schema.json",
                    })
                )
            );
            mockWindow.showInformationMessage.resolves("No" as any);
            const document = await vscode.workspace.openTextDocument(configFileUri);

            await handleSchemaUpdate(document, workspaceContext);

            const config = await getSchema();
            expect(config).to.have.property(
                "$schema",
                "https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/main/config.schema.json"
            );
        });
    });
});
