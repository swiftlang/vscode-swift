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
import { Version } from "../../../src/utilities/version";
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

async function buildProject(ctx: WorkspaceContext, name: string) {
    await waitForNoRunningTasks();
    const folderContext = await folderInRootWorkspace(name, ctx);
    const task = (await getBuildAllTask(folderContext)) as SwiftTask;
    const { exitCode, output } = await executeTaskAndWaitForResult(task);
    expect(exitCode, `${output}`).to.equal(0);
}

suite("Language Client Integration Suite @slow", function () {
    let clientManager: LanguageClientManager;
    let workspaceContext: WorkspaceContext;

    activateExtensionForSuite({
        async setup(ctx) {
            this.timeout(5 * 60 * 1000);

            workspaceContext = ctx;

            // Wait for a clean starting point, and build all tasks for the fixture
            if (workspaceContext.swiftVersion.isGreaterThanOrEqual(new Version(6, 1, 0))) {
                await buildProject(ctx, "swift-macro");
            }
            await buildProject(ctx, "defaultPackage");

            // Ensure lsp client is ready
            clientManager = ctx.languageClientManager;
            const clientState = await waitForClientState(clientManager, langclient.State.Running);
            expect(clientState).to.equals(langclient.State.Running);
        },
    });

    test("Expand Macro", async function () {
        // Expand Macro support in Swift started from 6.1
        if (workspaceContext.swiftVersion.isLessThan(new Version(6, 1, 0))) {
            this.skip();
        }

        // Focus on the file of interest
        const uri = testAssetUri("swift-macro/Sources/swift-macroClient/main.swift");
        await vscode.window.showTextDocument(uri);

        // Beginning of macro, #
        const position = new vscode.Position(5, 21);

        // Create a range starting and ending at the specified position
        const range = new vscode.Range(position, position);

        // Execute the code action provider command
        const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            "vscode.executeCodeActionProvider",
            uri,
            range
        );

        const expectedMacro = '(a + b, "a + b")';

        // Find the "expand.macro.command" action
        const expandMacroAction = codeActions.find(
            action => action.command?.command === "expand.macro.command"
        );

        // Assert that the expand macro command is available
        expect(expandMacroAction).is.not.undefined;

        // Set up a promise that resolves when the expected document is opened
        const expandedMacroUriPromise = new Promise<vscode.TextDocument>((resolve, reject) => {
            const disposable = vscode.workspace.onDidOpenTextDocument(openedDocument => {
                if (openedDocument.uri.scheme === "sourcekit-lsp") {
                    disposable.dispose(); // Stop listening once we find the desired document
                    resolve(openedDocument);
                }
            });

            // Set a timeout to reject the promise if the document is not found
            setTimeout(() => {
                disposable.dispose();
                reject(new Error("Timed out waiting for sourcekit-lsp document to be opened."));
            }, 10000); // Wait up to 10 seconds for the document
        });

        // Run expand macro action
        const command = expandMacroAction!.command!;
        expect(command.arguments).is.not.undefined;
        const commandArgs = command.arguments!;
        await vscode.commands.executeCommand(command.command, ...commandArgs);

        // Wait for the expanded macro document to be opened
        const referenceDocument = await expandedMacroUriPromise;

        // Verify that the reference document was successfully opened
        expect(referenceDocument).to.not.be.undefined;

        // Assert that the content contains the expected result
        const content = referenceDocument.getText();
        expect(content).to.include(expectedMacro);
    });

    suite("Symbols", () => {
        const uri = testAssetUri("defaultPackage/Sources/PackageExe/main.swift");
        const expectedDefinitionUri = testAssetUri(
            "defaultPackage/Sources/PackageLib/PackageLib.swift"
        );
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
                2,
                "There should be two references to 'a'."
            );

            // Extract reference URIs and sort them to have a predictable order
            const referenceUris = referenceLocations.map(ref => ref.uri.toString()).sort();
            const expectedUris = [
                uri.toString(), // Reference in main.swift
                expectedDefinitionUri.toString(), // Reference in PackageLib.swift
            ].sort();

            expect(referenceUris).to.deep.equal(expectedUris);
        });
    });
});
