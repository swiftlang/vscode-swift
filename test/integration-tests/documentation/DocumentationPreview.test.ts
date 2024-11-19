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
import contextKeys from "../../../src/contextKeys";
import { expect } from "chai";
import { folderContextPromise, globalWorkspaceContextPromise } from "../extension.test";
import { waitForNoRunningTasks } from "../../utilities";
import { testAssetUri } from "../../fixtures";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Commands } from "../../../src/commands";
import { Workbench } from "../../../src/utilities/commands";
import { RenderNode } from "../../../src/documentation/webview/WebviewMessage";

suite("Documentation Preview", function () {
    // Tests are short, but rely on SourceKit-LSP: give 30 seconds for each one
    this.timeout(30 * 1000);
    //this.timeout(30 * 30 * 1000);

    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;

    suiteSetup(async function () {
        workspaceContext = await globalWorkspaceContextPromise;
        await waitForNoRunningTasks();
        folderContext = await folderContextPromise("SlothCreatorExample");
        await workspaceContext.focusFolder(folderContext);
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand(Workbench.ACTION_CLOSEALLEDITORS);
    });

    setup(function () {
        if (!contextKeys.supportsDocumentationRendering) {
            this.skip();
        }
    });

    async function initialRenderTest(
        uri: string,
        expectedContent: string,
        editToCheck: string
    ): Promise<{ editor: vscode.TextEditor; document: vscode.TextDocument }> {
        // Set up content promise before file set up
        const contentPromise = waitForNextContentUpdate(workspaceContext);

        // Open a Swift file before we launch the documentation preview
        const swiftFileUri = testAssetUri(uri);
        const initPos = new vscode.Position(0, 0);
        const document = await vscode.workspace.openTextDocument(swiftFileUri);
        const editor = await vscode.window.showTextDocument(document, {
            selection: new vscode.Selection(initPos, initPos),
        });

        // Check if the webview panel is visible, if running in isolation the preview command has to
        // be executed, otherwise we can proceed with the test steps reusing the preview panel
        if (!isTabVisible("swift.previewDocumentationEditor", "Preview Swift Documentation")) {
            // Launch the documentation preview and wait for render to complete
            await expect(vscode.commands.executeCommand(Commands.PREVIEW_DOCUMENTATION)).to
                .eventually.be.true;
        }
        await expect(waitForRender(workspaceContext)).to.eventually.be.true;

        // Wait for the test promise to complete
        console.log("Waiting for initial content update...");
        const updatedContent = await contentPromise;
        const updatedContentString = JSON.stringify(updatedContent, null, 2);

        // Assert that the content text contain the right content
        expect(updatedContentString, `${updatedContentString}`).to.include(expectedContent);
        expect(updatedContentString, `${updatedContentString}`).to.not.include(editToCheck);
        return { editor, document };
    }

    test("renders documentation for an opened Swift file", async function () {
        // Check for initial Render
        const expectedEdit = "my edit: swift file";
        const { editor, document } = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/Models/Sloth.swift",
            "A model representing a sloth.",
            expectedEdit
        );

        // Set up test promise
        let contentPromise = waitForNextContentUpdate(workspaceContext);

        // Edit the focused text document, appending expected edit at the end of line 3
        const line = 2; // Line 3 in zero-based index
        await editor.edit(editBuilder => {
            const lineEnd = document.lineAt(line).range.end;
            editBuilder.insert(lineEnd, expectedEdit);
        });

        // Update the cursor position to the end of the inserted text
        const newCursorPos = new vscode.Position(
            line,
            document.lineAt(line).range.end.character + expectedEdit.length
        );
        editor.selection = new vscode.Selection(newCursorPos, newCursorPos);

        // FIXME: We are off by 1 right now... so need to do 1 more action
        // FIXME: Also the above is consistent only if on cached-run (second run and onwards)
        await waitForRender(workspaceContext);
        console.log("Waiting for post edit content update...");
        let updatedContent = await contentPromise;
        let updatedContentString = JSON.stringify(updatedContent, null, 2);
        expect(updatedContentString, `${updatedContentString}`).to.not.include(expectedEdit);

        // Set up test promise, and change selection which will trigger an update
        contentPromise = waitForNextContentUpdate(workspaceContext);
        const initPos = new vscode.Position(0, 0);
        editor.selection = new vscode.Selection(initPos, initPos);

        // Wait for render and test promise to complete
        await waitForRender(workspaceContext);
        console.log("Waiting for post edit content update, FIXME: 1+ action...");
        updatedContent = await contentPromise;
        updatedContentString = JSON.stringify(updatedContent, null, 2);
        expect(updatedContentString, `${updatedContentString}`).to.include(expectedEdit);
    });

    test("renders documentation for a tutorial overview file", async function () {
        // Check for initial Render
        const expectedEdit = "my edit: tutorial overview";
        const { editor, document } = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/Tutorials/SlothCreator.tutorial",
            "Meet SlothCreator",
            expectedEdit
        );
    });

    test("renders documentation for a single tutorial file", async function () {
        // Check for initial Render
        const expectedEdit = "my edit: single tutorial";
        const { editor, document } = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/Tutorials/Creating Custom Sloths.tutorial",
            "Creating Custom Sloths",
            expectedEdit
        );
    });

    test("renders documentation for a generic markdown file", async function () {
        // Check for initial Render
        const expectedEdit = "my edit: generic markdown";
        const { editor, document } = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/GettingStarted.md",
            "Getting Started with Sloths",
            expectedEdit
        );
    });

    test("renders documentation for a symbol linkage markdown file", async function () {
        // FIXME: This is not working yet
        this.skip();
        // Check for initial Render
        const expectedEdit = "my edit: symbol linkage markdown";
        const { editor, document } = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/GettingStarted.md",
            "Getting Started with Sloths",
            expectedEdit
        );
    });

    test("renders documentation for a symbol providing markdown file", async function () {
        // FIXME: This is not working yet
        this.skip();
        // Check for initial Render
        const expectedEdit = "my edit: symbol providing markdown";
        const { editor, document } = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/SlothCreator.md",
            "Catalog sloths you find",
            expectedEdit
        );
    });
});

function waitForNextContentUpdate(context: WorkspaceContext): Promise<RenderNode> {
    return new Promise<RenderNode>(resolve => {
        const disposable = context.documentation.onPreviewDidUpdateContent(
            (renderNode: RenderNode) => {
                resolve(renderNode);
                disposable.dispose();
            }
        );
    });
}

function waitForRender(context: WorkspaceContext): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        const disposable = context.documentation.onPreviewDidRenderContent(() => {
            resolve(true);
            disposable.dispose();
        });
    });
}

function isTabVisible(viewType: string, title: string): boolean {
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            // Check if the tab is of type TabInputWebview and matches the viewType and title
            if (
                tab.input instanceof vscode.TabInputWebview &&
                tab.input.viewType.includes(viewType) &&
                tab.label === title
            ) {
                // We are not checking if tab is active, so return true as long as the if clause is true
                return true;
            }
        }
    }
    return false;
}
