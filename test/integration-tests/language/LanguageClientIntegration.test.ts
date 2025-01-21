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
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities/tasks";
import { getBuildAllTask, SwiftTask } from "../../../src/tasks/SwiftTaskProvider";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";
import { waitForClientState, waitForIndex } from "../utilities/lsputilities";

async function buildProject(ctx: WorkspaceContext, name: string) {
    await waitForNoRunningTasks();
    const folderContext = await folderInRootWorkspace(name, ctx);
    const task = (await getBuildAllTask(folderContext)) as SwiftTask;
    const { exitCode, output } = await executeTaskAndWaitForResult(task);
    expect(exitCode, `${output}`).to.equal(0);
    return folderContext;
}

suite("Language Client Integration Suite @slow", function () {
    this.timeout(2 * 60 * 1000);

    let clientManager: LanguageClientManager;
    let workspaceContext: WorkspaceContext;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;

            await buildProject(ctx, "defaultPackage");

            // Ensure lsp client is ready
            clientManager = ctx.languageClientManager;
            await waitForClientState(clientManager, langclient.State.Running);
        },
    });

    setup(async () => {
        await waitForIndex(workspaceContext.languageClientManager);
    });

    suite("Symbols", () => {
        const uri = testAssetUri("defaultPackage/Sources/PackageExe/main.swift");
        const expectedDefinitionUri = testAssetUri(
            "defaultPackage/Sources/PackageLib/PackageLib.swift"
        );
        const snippetUri = testAssetUri("defaultPackage/Snippets/hello.swift");
        // Position of the symbol 'a' in main.swift
        const position = new vscode.Position(2, 6);

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

            expect(definitionLocations).to.have.lengthOf(
                1,
                "There should be one definition of 'a'."
            );

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
            expect(referenceLocations).to.have.lengthOf(
                3,
                "There should be two references to 'a'."
            );

            // Extract reference URIs and sort them to have a predictable order
            const referenceUris = referenceLocations.map(ref => ref.uri.toString());
            const expectedUris = [
                snippetUri.toString(),
                uri.toString(), // Reference in main.swift
                expectedDefinitionUri.toString(), // Reference in PackageLib.swift
            ];

            for (const uri of expectedUris) {
                expect(referenceUris).to.contain(uri);
            }
        });
    });
});
