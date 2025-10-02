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
import * as langclient from "vscode-languageclient/node";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { LanguageClientManager } from "@src/sourcekit-lsp/LanguageClientManager";
import { createBuildAllTask } from "@src/tasks/SwiftTaskProvider";

import { testAssetUri } from "../../fixtures";
import { tag } from "../../tags";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities/tasks";
import { waitForClientState } from "../utilities/lsputilities";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

async function buildProject(ctx: WorkspaceContext, name: string) {
    await waitForNoRunningTasks();
    const folderContext = await folderInRootWorkspace(name, ctx);
    const task = await createBuildAllTask(folderContext);
    task.definition.dontTriggerTestDiscovery = true;
    const { exitCode, output } = await executeTaskAndWaitForResult(task);
    expect(exitCode, `${output}`).to.equal(0);
    return folderContext;
}

tag("large").suite("Language Client Integration Suite", function () {
    let clientManager: LanguageClientManager;
    let folderContext: FolderContext;

    activateExtensionForSuite({
        async setup(ctx) {
            if (process.platform === "win32") {
                this.skip();
                return;
            }
            folderContext = await buildProject(ctx, "defaultPackage");

            // Ensure lsp client is ready
            clientManager = ctx.languageClientManager.get(folderContext);
            await clientManager.restart();
            await waitForClientState(clientManager, langclient.State.Running);
            await clientManager.waitForIndex();
        },
    });

    setup(async () => {
        await clientManager.waitForIndex();
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

            // We expect 3 references - in `main.swift`, in `PackageLib.swift` and in `hello.swift`
            expect(referenceLocations).to.have.lengthOf(
                3,
                "There should be three references to 'a'."
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
