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
import { SourceKitLanguageClient } from "@src/sourcekit-lsp/client/SourceKitLanguageClient";
import { createBuildAllTask } from "@src/tasks/SwiftTaskProvider";

import { testAssetUri } from "../../fixtures";
import { tag } from "../../tags";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities/tasks";
import { waitForClientState, waitForIndex } from "../utilities/lsputilities";
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
    let languageClient: SourceKitLanguageClient;
    let folderContext: FolderContext;

    activateExtensionForSuite({
        async setup(api) {
            const ctx = await api.waitForWorkspaceContext();
            if (process.platform === "win32") {
                this.skip();
            }
            folderContext = await buildProject(ctx, "defaultPackage");
            languageClient = ctx.languageClientManager.getClient(folderContext);
            await waitForClientState(languageClient, langclient.State.Running);
            await waitForIndex(languageClient);
        },
    });

    suite("CodeLens", () => {
        test("adds VS Code iconography to Run and Debug CodeLenses", async () => {
            const uri = testAssetUri("defaultPackage/Tests/PackageTests/PackageTests.swift");
            const editor = await vscode.window.showTextDocument(uri);

            const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
                "vscode.executeCodeLensProvider",
                editor.document.uri
            );

            const runLens = codeLenses?.find(cl => cl.command?.command === "swift.run");
            const debugLens = codeLenses?.find(cl => cl.command?.command === "swift.debug");

            if (runLens) {
                expect(runLens.command!.title).to.match(/^\$\(play\)/);
            }
            if (debugLens) {
                expect(debugLens.command!.title).to.match(/^\$\(debug\)/);
            }
        });
    });

    suite("Completions", () => {
        test("adds parameter hints command to function completions", async () => {
            const uri = testAssetUri("defaultPackage/Sources/PackageExe/main.swift");
            const editor = await vscode.window.showTextDocument(uri);

            const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
                "vscode.executeCompletionItemProvider",
                editor.document.uri,
                new vscode.Position(2, 5)
            );

            const functionItems = completions.items.filter(
                item =>
                    item.kind === vscode.CompletionItemKind.Function ||
                    item.kind === vscode.CompletionItemKind.Method
            );

            expect(functionItems).to.have.length.greaterThan(0);
            for (const item of functionItems) {
                expect(item.command?.command).to.equal("editor.action.triggerParameterHints");
            }
        });

        test("does not add parameter hints to property completions", async () => {
            const uri = testAssetUri("defaultPackage/Sources/PackageExe/main.swift");
            const editor = await vscode.window.showTextDocument(uri);

            const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
                "vscode.executeCompletionItemProvider",
                editor.document.uri,
                new vscode.Position(2, 0)
            );

            const propertyItems = completions.items.filter(
                item => item.kind === vscode.CompletionItemKind.Property
            );

            for (const item of propertyItems) {
                expect(item.command?.command).to.not.equal("editor.action.triggerParameterHints");
            }
        });
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
        test("Find All References excludes declaration when setting is never", async function () {
            const config = vscode.workspace.getConfiguration("swift.sourcekit-lsp");
            await config.update(
                "includeDeclarationInFindAllReferences",
                "never",
                vscode.ConfigurationTarget.Workspace
            );
            try {
                const editor = await vscode.window.showTextDocument(uri);
                const document = editor.document;

                const referenceLocations = await vscode.commands.executeCommand<vscode.Location[]>(
                    "vscode.executeReferenceProvider",
                    document.uri,
                    position
                );

                // We expect the declaration in `PackageLib.swift` to be excluded,
                // usages in `main.swift` and `hello.swift` remain.
                const referenceUris = referenceLocations.map(ref => ref.uri.toString());
                expect(referenceUris).to.not.contain(expectedDefinitionUri.toString());
                expect(referenceUris).to.contain(uri.toString());
                expect(referenceUris).to.contain(snippetUri.toString());
            } finally {
                await config.update(
                    "includeDeclarationInFindAllReferences",
                    undefined,
                    vscode.ConfigurationTarget.Workspace
                );
            }
        });
    });
});
