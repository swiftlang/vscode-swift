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
import { expect } from "chai";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { Commands } from "@src/commands";
import {
    determineSchemaURL,
    handleConfigFileChange,
    handleSchemaUpdate,
    sourcekitConfigFilePath,
    sourcekitFolderPath,
} from "@src/commands/generateSourcekitConfiguration";
import * as restartLSPServerModule from "@src/commands/restartLSPServer";
import { Version } from "@src/utilities/version";

import { mockGlobalModule, mockGlobalObject } from "../../MockUtils";
import { closeAllEditors } from "../../utilities/commands";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "../utilities/testutilities";

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
        async setup(api) {
            const ctx = await api.waitForWorkspaceContext();
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
        const mockRestartLSPServerModule = mockGlobalModule(restartLSPServerModule);

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

            expect(mockWindow.showInformationMessage).to.have.not.been.calledWith(
                `The $schema property for ${configFileUri.fsPath} is not set to the version of the Swift toolchain that you are using. Would you like to update the $schema property?`,
                "Yes",
                "No",
                "Don't Ask Again"
            );
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

        test("Check LSP restart prompt for config.json modifications", async () => {
            await vscode.workspace.fs.writeFile(
                configFileUri,
                Buffer.from(
                    JSON.stringify({
                        $schema: "invalid schema",
                    })
                )
            );
            await handleConfigFileChange(configFileUri, workspaceContext);

            expect(mockWindow.showInformationMessage).to.have.been.called;
            expect(mockWindow.showInformationMessage).to.have.been.calledWith(
                `The SourceKit-LSP configuration file has been modified. Would you like to restart the language server to apply the changes?`,
                "Restart LSP Server",
                "Not Now"
            );

            mockWindow.showInformationMessage.resolves("Restart LSP Server" as any);

            await handleConfigFileChange(configFileUri, workspaceContext);
            expect(mockRestartLSPServerModule.default).to.have.been.calledWith(workspaceContext);
        });
    });
});
