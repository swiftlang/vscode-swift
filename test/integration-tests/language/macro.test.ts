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

suite("Integration, Macros Functionality Support with Sourcekit-lsp", function () {
    // Take around 60 seconds if running in isolation, longer than default timeout
    this.timeout(2 * 60 * 1000);

    let clientManager: LanguageClientManager;
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            // Expand Macro support in Swift started from 6.1
            if (workspaceContext.swiftVersion.isLessThan(new Version(6, 1, 0))) {
                this.skip();
            }

            // Wait for a clean starting point, and build all tasks for the fixture
            await waitForNoRunningTasks();
            folderContext = await folderInRootWorkspace("swift-macro", workspaceContext);
            await workspaceContext.focusFolder(folderContext);
            const tasks = (await getBuildAllTask(folderContext)) as SwiftTask;
            const { exitCode, output } = await executeTaskAndWaitForResult(tasks);
            expect(exitCode, `${output}`).to.equal(0);

            // Ensure lsp client is ready
            clientManager = workspaceContext.languageClientManager;
            const clientState = await waitForClientState(clientManager, langclient.State.Running);
            expect(clientState).to.equals(langclient.State.Running);
        },
    });

    test("Expand Macro", async function () {
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
});
