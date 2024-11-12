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
import { expect } from "chai";
import { folderContextPromise, globalWorkspaceContextPromise } from "../extension.test";
import { waitForNoRunningTasks } from "../../utilities";
import { testAssetUri } from "../../fixtures";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Commands } from "../../../src/commands";
import { Workbench } from "../../../src/utilities/commands";
import { RenderNode } from "../../../src/documentation/webview/WebviewMessage";

suite("Documentation Preview Editor", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;

    suiteSetup(async function () {
        workspaceContext = await globalWorkspaceContextPromise;
        await waitForNoRunningTasks();
        folderContext = await folderContextPromise("SlothCreatorBuildingDocCDocumentationInXcode");
        await workspaceContext.focusFolder(folderContext);
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand(Workbench.ACTION_CLOSEALLEDITORS);
    });

    test("renders documentation for an opened Swift file", async function () {
        // Open a Swift file before we launch the documentation preview
        await vscode.window.showTextDocument(
            testAssetUri(
                "SlothCreatorBuildingDocCDocumentationInXcode/Sources/SlothCreator/Models/Sloth.swift"
            )
        );

        // Launch the documentation preview and wait for the content to update
        await expect(vscode.commands.executeCommand(Commands.PREVIEW_DOCUMENTATION)).to.eventually
            .be.true;

        // Wait for the content to be updated
        const renderedContent = await waitForNextContentUpdate(workspaceContext);
        const uri = vscode.Uri.parse(renderedContent.identifier.url);
        expect(uri.path).to.equal("/documentation/Sloth/Sloth");
    });
});

function waitForNextContentUpdate(context: WorkspaceContext): Promise<RenderNode> {
    return new Promise<RenderNode>(resolve => {
        context.documentation.onPreviewDidUpdateContent(resolve);
    });
}
