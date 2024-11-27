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
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";
import { waitForNoRunningTasks } from "../../utilities";
import { testAssetUri } from "../../fixtures";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Commands } from "../../../src/commands";
import { Workbench } from "../../../src/utilities/commands";
import { RenderNode } from "../../../src/documentation/webview/WebviewMessage";
import { PreviewEditorConstant } from "../../../src/documentation/DocumentationPreviewEditor";

suite("Documentation Preview", function () {
    // Tests are short, but rely on SourceKit-LSP: give 30 seconds for each one
    this.timeout(30 * 1000);

    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            await waitForNoRunningTasks();
            folderContext = await folderInRootWorkspace("SlothCreatorExample", ctx);
            await ctx.focusFolder(folderContext);
        },
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand(Workbench.ACTION_CLOSEALLEDITORS);
    });

    setup(function () {
        if (!contextKeys.supportsDocumentationRendering) {
            this.skip();
        }
    });

    async function editRenderTest(
        position: vscode.Position,
        expectedEdit: string,
        editor: vscode.TextEditor
    ) {
        // Set up test promise
        const contentPromise = waitForNextContentUpdate(workspaceContext);

        // Edit the focused text document, appending expected edit at the end of provided position
        await editor.edit(editBuilder => editBuilder.insert(position, expectedEdit));

        // Update the cursor position to the end of the inserted text
        const newCursorPos = new vscode.Position(
            position.line,
            position.character + expectedEdit.length
        );
        editor.selection = new vscode.Selection(newCursorPos, newCursorPos);

        await expect(waitForRender(workspaceContext)).to.eventually.be.true;
        const updatedContent = await contentPromise;
        const updatedContentString = JSON.stringify(updatedContent, null, 2);
        expect(updatedContentString, `${updatedContentString}`).to.include(expectedEdit);
    }

    async function initialRenderTest(
        uri: string,
        expectedContent: string,
        editToCheck: string
    ): Promise<vscode.TextEditor> {
        // Set up content promise before file set up
        const contentPromise = waitForNextContentUpdate(workspaceContext);

        // Open a Swift file before we launch the documentation preview
        const swiftFileUri = testAssetUri(uri);
        const initPos = new vscode.Position(0, 0);
        const editor = await vscode.window.showTextDocument(swiftFileUri, {
            selection: new vscode.Selection(initPos, initPos),
        });

        // Check if the webview panel is visible, if running in isolation the preview command has to
        // be executed, otherwise we can proceed with the test steps reusing the preview panel
        if (!findTab(PreviewEditorConstant.VIEW_TYPE, PreviewEditorConstant.TITLE)) {
            // Launch the documentation preview and wait for render to complete
            await expect(vscode.commands.executeCommand(Commands.PREVIEW_DOCUMENTATION)).to
                .eventually.be.true;
        }
        await expect(waitForRender(workspaceContext)).to.eventually.be.true;

        // Wait for the test promise to complete
        const updatedContent = await contentPromise;
        const updatedContentString = JSON.stringify(updatedContent, null, 2);

        // Assert that the content text contain the right content
        expect(updatedContentString, `${updatedContentString}`).to.include(expectedContent);
        expect(updatedContentString, `${updatedContentString}`).to.not.include(editToCheck);
        return editor;
    }

    test("renders documentation for an opened Swift file + edit rendering", async function () {
        // Check for initial Render
        const expectedEdit = "my edit: swift file";
        const editor = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/Models/Sloth.swift",
            "A model representing a sloth.",
            expectedEdit
        );

        // Set up test promise
        let contentPromise = waitForNextContentUpdate(workspaceContext);
        const insertPos = new vscode.Position(2, 32);

        // Edit the focused text document, appending expected edit at the end of position
        await editor.edit(editBuilder => editBuilder.insert(insertPos, expectedEdit));

        // Update the cursor position to the end of the inserted text
        const newCursorPos = new vscode.Position(
            insertPos.line,
            insertPos.character + expectedEdit.length
        );
        editor.selection = new vscode.Selection(newCursorPos, newCursorPos);

        // FIXME: We are off by 1 right now... so need to do 1 more action
        // FIXME: Also the off by 1 behaviour is consistent only if on cached-run (second run and onwards)
        await expect(waitForRender(workspaceContext)).to.eventually.be.true;
        let updatedContent = await contentPromise;
        let updatedContentString = JSON.stringify(updatedContent, null, 2);
        expect(updatedContentString, `${updatedContentString}`).to.not.include(expectedEdit);

        // Set up test promise, and change selection which will trigger an update
        contentPromise = waitForNextContentUpdate(workspaceContext);
        const initPos = new vscode.Position(0, 0);
        editor.selection = new vscode.Selection(initPos, initPos);

        // Wait for render and test promise to complete
        await expect(waitForRender(workspaceContext)).to.eventually.be.true;
        updatedContent = await contentPromise;
        updatedContentString = JSON.stringify(updatedContent, null, 2);
        expect(updatedContentString, `${updatedContentString}`).to.include(expectedEdit);
    });

    test("Cursor switch: Opened Swift file, documentation to symbol, symbol edit rendering", async function () {
        // Check for initial Render
        const expectedSymbol = "comfortLevel";
        const editor = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/Models/Habitat.swift",
            "The habitat where sloths live.",
            expectedSymbol
        );

        // Set up test promise, and change to a location of a symbol: comfortLevel
        const contentPromise = waitForNextContentUpdate(workspaceContext);
        const symbolPos = new vscode.Position(25, 15);
        editor.selection = new vscode.Selection(symbolPos, symbolPos);

        // Wait for render and test promise to complete
        await expect(waitForRender(workspaceContext)).to.eventually.be.true;
        const updatedContent = await contentPromise;
        const updatedContentString = JSON.stringify(updatedContent, null, 2);
        expect(updatedContentString, `${updatedContentString}`).to.include(expectedSymbol);

        // Insert edit at the desired position and assert for change: comfortLevel symbol
        await editRenderTest(new vscode.Position(25, 27), "Atlantis", editor);
    });

    test("renders documentation for a tutorial overview file + edit rendering", async function () {
        // Check for initial Render
        const expectedEdit = "my edit: tutorial overview";
        const editor = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/Tutorials/SlothCreator.tutorial",
            "Meet SlothCreator",
            expectedEdit
        );

        // Insert edit at the desired position and assert for change
        await editRenderTest(new vscode.Position(2, 128), expectedEdit, editor);
    });

    test("renders documentation for a single tutorial file + edit rendering", async function () {
        // Check for initial Render
        const expectedEdit = "my edit: single tutorial";
        const editor = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/Tutorials/Creating Custom Sloths.tutorial",
            "Creating Custom Sloths",
            expectedEdit
        );

        // Insert edit at the desired position and assert for change
        await editRenderTest(new vscode.Position(2, 109), expectedEdit, editor);
    });

    test("renders documentation for a generic markdown file + edit rendering", async function () {
        // Check for initial Render
        const expectedEdit = "my edit: generic markdown";
        const editor = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/GettingStarted.md",
            "Getting Started with Sloths",
            expectedEdit
        );

        // Insert edit at the desired position and assert for change
        await editRenderTest(new vscode.Position(2, 25), expectedEdit, editor);
    });

    test("renders documentation for a symbol linkage markdown file + edit rendering", async function () {
        // FIXME: This feature is not implemented yet
        this.skip();
        // Check for initial Render
        const expectedEdit = "my edit: symbol linkage markdown";
        const editor = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/SlothCreator.md",
            "Catalog sloths you find",
            expectedEdit
        );

        // Insert edit at the desired position and assert for change
        await editRenderTest(new vscode.Position(2, 33), expectedEdit, editor);
    });

    test("renders documentation for a symbol providing markdown file + edit rendering", async function () {
        // FIXME: This feature is not implemented yet
        this.skip();
        // Check for initial Render
        const expectedEdit = "my edit: symbol providing markdown";
        const editor = await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/Extensions/Sloth.md",
            "Creating a Sloth",
            expectedEdit
        );

        // Insert edit at the desired position and assert for change
        await editRenderTest(new vscode.Position(4, 14), expectedEdit, editor);
    });

    test("Focus switch: visible tab", async function () {
        // Check for initial Render
        const contentInTab2 = "Creating Custom Sloths";
        const expectedContent = "Meet SlothCreator";
        await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/Tutorials/SlothCreator.tutorial",
            expectedContent,
            contentInTab2
        );

        // Open tab 2 in the same tab group as the webview renderer
        const webviewTabNullable = findTab(
            PreviewEditorConstant.VIEW_TYPE,
            PreviewEditorConstant.TITLE
        );
        expect(webviewTabNullable).to.not.be.undefined;
        const webviewTab = webviewTabNullable!;
        const newTutorialUri = testAssetUri(
            "SlothCreatorExample/Sources/SlothCreator/SlothCreator.docc/Tutorials/Creating Custom Sloths.tutorial"
        );
        await vscode.window.showTextDocument(newTutorialUri, {
            viewColumn: webviewTab.group.viewColumn,
        });

        // Set up test promise, and swap back to the previous editor (webview panel)
        const contentPromise = waitForNextContentUpdate(workspaceContext);
        await vscode.commands.executeCommand(Workbench.ACTION_PREVIOUSEDITORINGROUP);

        // Wait for render and assert webview panel retains render of last focused editor when the panel is visible
        await expect(waitForRender(workspaceContext)).to.eventually.be.true;
        const updatedContent = await contentPromise;
        const updatedContentString = JSON.stringify(updatedContent, null, 2);
        // FIXME: This feature is not implemented yet
        expect(updatedContentString, `${updatedContentString}`).to.include(expectedContent);
    });

    test("Focus switch: Swift extension", async function () {
        // FIXME: This feature is not implemented yet
        this.skip();
        // Check for initial Render
        const extensionContent = "Food that a sloth can consume";
        await initialRenderTest(
            "SlothCreatorExample/Sources/SlothCreator/Models/Sloth.swift",
            "A model representing a sloth.",
            extensionContent
        );

        // Set up test promise, and open an extension Swift file
        const contentPromise = waitForNextContentUpdate(workspaceContext);
        const extensionUri = testAssetUri(
            "SlothCreatorExample/Sources/SlothCreator/Models/Food.swift"
        );
        const initPos = new vscode.Position(0, 0);
        await vscode.window.showTextDocument(extensionUri, {
            selection: new vscode.Selection(initPos, initPos),
        });

        // Wait for render and assert webview panel to displayed that no documentation is available
        await expect(waitForRender(workspaceContext)).to.eventually.be.true;
        const updatedContent = await contentPromise;
        const updatedContentString = JSON.stringify(updatedContent, null, 2);
        expect(updatedContentString, `${updatedContentString}`).to.include(
            "Documentation is not available."
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

function findTab(viewType: string, title: string): vscode.Tab | undefined {
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            // Check if the tab is of type TabInputWebview and matches the viewType and title
            if (
                tab.input instanceof vscode.TabInputWebview &&
                tab.input.viewType.includes(viewType) &&
                tab.label === title
            ) {
                // We are not checking if tab is active, so return true as long as the if clause is true
                return tab;
            }
        }
    }
    return undefined;
}
