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
import { NavigateMessage } from "../../../src/documentation/webview/WebviewMessage";

suite("DocC Documentation Preview", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;
    this.timeout(2 * 60 * 1000); // Allow up to 2 minutes to build

    suiteSetup(async function () {
        workspaceContext = await globalWorkspaceContextPromise;
        await waitForNoRunningTasks();
        folderContext = await folderContextPromise("SlothCreatorBuildingDocCDocumentationInXcode");
        await workspaceContext.focusFolder(folderContext);
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand(Workbench.ACTION_CLOSEALLEDITORS);
    });

    test("Markdown Focus", async () => {
        // Call the command under test
        let result = await vscode.commands.executeCommand(Commands.PREVIEW_DOCUMENTATION);
        expect(result).to.be.true;

        // Listen for the 'navigate' event, assert that the right message is being sent to the renderer
        const onNavigateEvent = workspaceContext.documentation.getEditorOnNavigateEvent();
        expect(onNavigateEvent).to.not.equal(undefined);

        // Set up a promise to listen for the 'navigate' event and assert the message
        const messagePromise = new Promise<boolean>((resolve, reject) => {
            const listener = (message: NavigateMessage) => {
                try {
                    // Assert the message contents
                    expect(message.type).to.equal("navigate");
                    expect(message.route).to.equal("/documentation/SlothCreator/GettingStarted");
                    resolve(true); // Resolve the promise after the assertion passes
                } catch (err) {
                    reject(err); // Reject the promise if the assertion fails
                } finally {
                    // Remove the event listener after it has been used
                    onNavigateEvent!.event(listener).dispose();
                }
            };

            // Attach the listener to the event
            onNavigateEvent!.event(listener);
        });

        // Focus on file under test
        const uri = testAssetUri(
            "SlothCreatorBuildingDocCDocumentationInXcode/Sources/SlothCreator/SlothCreator.docc/GettingStarted.md"
        );
        await vscode.window.showTextDocument(uri);

        // Await the promise to ensure that the message is received and assertions are completed
        result = await messagePromise;
        expect(result).to.be.true;
    });
});
