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
import * as langclient from "vscode-languageclient/node";
import { expect } from "chai";
import { LanguageClientManager } from "../../../src/sourcekit-lsp/LanguageClientManager";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { testAssetUri } from "../../fixtures";
import { FolderContext } from "../../../src/FolderContext";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities";
import { SwiftTask } from "../../../src/tasks/SwiftTaskProvider";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

async function waitForClientState(
    languageClientManager: LanguageClientManager,
    expectedState: langclient.State
): Promise<langclient.State> {
    let clientState = undefined;
    while (clientState !== expectedState) {
        clientState = await languageClientManager.useLanguageClient(async client => client.state);
        console.warn("Language client is not ready yet. Retrying in 100 ms...");
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return clientState;
}

suite("Integration, Basic Language Support with Sourcekit-lsp", function () {
    this.timeout(60 * 1000);

    let clientManager: LanguageClientManager;
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;
    const uri = testAssetUri("defaultPackage/Sources/PackageExe/main.swift");
    const expectedDefinitionUri = testAssetUri(
        "defaultPackage/Sources/PackageLib/PackageLib.swift"
    );
    // Position of the symbol 'a' in main.swift
    const position = new vscode.Position(2, 6);

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            // Wait for a clean starting point, and run the build task for the fixture
            await waitForNoRunningTasks();
            folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
            await workspaceContext.focusFolder(folderContext);

            const tasks = await vscode.tasks.fetchTasks({ type: "swift" });
            const buildTask = tasks.find(t => t.name === "Build All (defaultPackage)");
            const { exitCode, output } = await executeTaskAndWaitForResult(buildTask as SwiftTask);
            expect(exitCode, `${output}`).to.equal(0);

            // Ensure lsp client is ready
            clientManager = workspaceContext.languageClientManager;
            const clientState = await waitForClientState(clientManager, langclient.State.Running);
            expect(clientState).to.equals(langclient.State.Running);
        },
    });

    test("Goto Definition", async function () {
        // Focus on the file of interest
        const editor = await vscode.window.showTextDocument(uri);
        const document = editor.document;

        // Position of the symbol 'a' in main.swift
        const definitionLocations = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeDefinitionProvider",
            document.uri,
            position
        );

        expect(definitionLocations).to.have.lengthOf(1, "There should be one definition of 'a'.");

        const definition = definitionLocations[0];

        // Assert that the definition is in PackageLib.swift at line 0
        expect(definition.uri.toString()).to.equal(expectedDefinitionUri.toString());
        expect(definition.range.start.line).to.equal(0);
    });

    test("Find All References", async function () {
        // Focus on the file of interest
        const editor = await vscode.window.showTextDocument(uri);
        const document = editor.document;

        const referenceLocations = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeReferenceProvider",
            document.uri,
            position
        );

        // We expect 2 references - one in `main.swift` and one in `PackageLib.swift`
        expect(referenceLocations).to.have.lengthOf(2, "There should be two references to 'a'.");

        // Extract reference URIs and sort them to have a predictable order
        const referenceUris = referenceLocations.map(ref => ref.uri.toString()).sort();
        const expectedUris = [
            uri.toString(), // Reference in main.swift
            expectedDefinitionUri.toString(), // Reference in PackageLib.swift
        ].sort();

        expect(referenceUris).to.deep.equal(expectedUris);
    });
});
