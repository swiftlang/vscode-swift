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
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { Commands } from "@src/commands";
import { PreviewEditorConstant } from "@src/documentation/DocumentationPreviewEditor";
import { RenderNodeContent, WebviewContent } from "@src/documentation/webview/WebviewMessage";
import { Workbench } from "@src/utilities/commands";

import { testAssetUri } from "../../fixtures";
import { tag } from "../../tags";
import { waitForNoRunningTasks } from "../../utilities/tasks";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

tag("medium").suite("Documentation Live Preview", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;

    activateExtensionForSuite({
        async setup(api) {
            const ctx = await api.waitForWorkspaceContext();
            workspaceContext = ctx;
            await waitForNoRunningTasks();
            folderContext = await folderInRootWorkspace("documentation-live-preview", ctx);
            await ctx.focusFolder(folderContext);
        },
    });

    setup(function () {
        if (!workspaceContext.contextKeys.supportsDocumentationLivePreview) {
            this.skip();
        }
    });

    teardown(async function () {
        await vscode.commands.executeCommand(Workbench.ACTION_CLOSEALLEDITORS);
    });

    test("renders documentation for an opened Swift file", async function () {
        const { webviewContent } = await launchLivePreviewEditor(workspaceContext, {
            filePath: "Sources/Library/Library.swift",
            position: new vscode.Position(0, 0),
        });
        expect(renderNodeString(webviewContent)).to.include(
            "The entry point for this arbitrary library."
        );
    });

    test("renders documentation when moving the cursor within an opened Swift file", async function () {
        const { textEditor } = await launchLivePreviewEditor(workspaceContext, {
            filePath: "Sources/Library/Library.swift",
            position: new vscode.Position(0, 0),
        });
        // Move the cursor to the comment above EntryPoint.name
        let webviewContent = await moveCursor(workspaceContext, {
            textEditor,
            position: new vscode.Position(7, 12),
        });
        expect(renderNodeString(webviewContent)).to.include("The name of this EntryPoint");
        // Move the cursor to the comment above EntryPoint.init(name:)
        webviewContent = await moveCursor(workspaceContext, {
            textEditor,
            position: new vscode.Position(10, 18),
        });
        expect(renderNodeString(webviewContent)).to.include("Creates a new EntryPoint");
    });

    test("renders documentation when editing an opened Swift file", async function () {
        const { textEditor } = await launchLivePreviewEditor(workspaceContext, {
            filePath: "Sources/Library/Library.swift",
            position: new vscode.Position(0, 0),
        });
        // Edit the comment above EntryPoint
        const webviewContent = await editDocument(workspaceContext, textEditor, editBuilder => {
            editBuilder.replace(new vscode.Selection(3, 29, 3, 38), "absolutely amazing");
        });
        expect(renderNodeString(webviewContent)).to.include(
            "The entry point for this absolutely amazing library."
        );
    });

    test("renders documentation for an opened Markdown article", async function () {
        const { webviewContent } = await launchLivePreviewEditor(workspaceContext, {
            filePath: "Sources/Library/Library.docc/GettingStarted.md",
            position: new vscode.Position(0, 0),
        });
        expect(renderNodeString(webviewContent)).to.include("This is the getting started page.");
    });

    test("renders documentation for an opened tutorial overview", async function () {
        const { webviewContent } = await launchLivePreviewEditor(workspaceContext, {
            filePath: "Sources/Library/Library.docc/TutorialOverview.tutorial",
            position: new vscode.Position(0, 0),
        });
        expect(renderNodeString(webviewContent)).to.include("Library Tutorial Overview");
    });

    test("renders documentation for an opened tutorial", async function () {
        const { webviewContent } = await launchLivePreviewEditor(workspaceContext, {
            filePath: "Sources/Library/Library.docc/Tutorial.tutorial",
            position: new vscode.Position(0, 0),
        });
        expect(renderNodeString(webviewContent)).to.include("Library Tutorial");
    });

    test("displays an error for an unsupported active document", async function () {
        const { webviewContent } = await launchLivePreviewEditor(workspaceContext, {
            filePath: "UnsupportedFile.txt",
            position: new vscode.Position(0, 0),
        });
        expect(webviewContent).to.have.property("type").that.equals("error");
        expect(webviewContent)
            .to.have.property("errorMessage")
            .that.equals(PreviewEditorConstant.UNSUPPORTED_EDITOR_ERROR_MESSAGE);
    });
});

async function launchLivePreviewEditor(
    workspaceContext: WorkspaceContext,
    options: {
        filePath: string;
        position: vscode.Position;
    }
): Promise<{ textEditor: vscode.TextEditor; webviewContent: WebviewContent }> {
    if (findTab(PreviewEditorConstant.VIEW_TYPE, PreviewEditorConstant.TITLE)) {
        throw new Error("The live preview editor cannot be launched twice in a single test");
    }
    const contentUpdatePromise = waitForNextContentUpdate(workspaceContext);
    const renderedPromise = waitForNextRender(workspaceContext);
    // Open up the test file before launching live preview
    const fileUri = testAssetUri(path.join("documentation-live-preview", options.filePath));
    const selection = new vscode.Selection(options.position, options.position);
    const textEditor = await vscode.window.showTextDocument(fileUri, { selection: selection });
    // Launch the documentation preview and wait for it to render
    expect(await vscode.commands.executeCommand(Commands.PREVIEW_DOCUMENTATION)).to.be.true;
    const [webviewContent] = await Promise.all([contentUpdatePromise, renderedPromise]);
    return { textEditor, webviewContent };
}

async function editDocument(
    workspaceContext: WorkspaceContext,
    textEditor: vscode.TextEditor,
    callback: (editBuilder: vscode.TextEditorEdit) => void
): Promise<WebviewContent> {
    const contentUpdatePromise = waitForNextContentUpdate(workspaceContext);
    const renderedPromise = waitForNextRender(workspaceContext);
    await expect(textEditor.edit(callback)).to.eventually.be.true;
    const [webviewContent] = await Promise.all([contentUpdatePromise, renderedPromise]);
    return webviewContent;
}

async function moveCursor(
    workspaceContext: WorkspaceContext,
    options: {
        textEditor: vscode.TextEditor;
        position: vscode.Position;
    }
): Promise<WebviewContent> {
    const contentUpdatePromise = waitForNextContentUpdate(workspaceContext);
    const renderedPromise = waitForNextRender(workspaceContext);
    options.textEditor.selection = new vscode.Selection(options.position, options.position);
    const [webviewContent] = await Promise.all([contentUpdatePromise, renderedPromise]);
    return webviewContent;
}

function renderNodeString(webviewContent: WebviewContent): string {
    expect(webviewContent).to.have.property("type").that.equals("render-node");
    return JSON.stringify((webviewContent as RenderNodeContent).renderNode);
}

function waitForNextContentUpdate(context: WorkspaceContext): Promise<WebviewContent> {
    return new Promise<WebviewContent>(resolve => {
        const disposable = context.documentation.onPreviewDidUpdateContent(
            (content: WebviewContent) => {
                resolve(content);
                disposable.dispose();
            }
        );
    });
}

function waitForNextRender(context: WorkspaceContext): Promise<boolean> {
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
