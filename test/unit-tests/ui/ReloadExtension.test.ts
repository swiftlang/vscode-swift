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
import { mockGlobalObject } from "../../MockUtils";
import * as vscode from "vscode";
import { showReloadExtensionNotification } from "../../../src/ui/ReloadExtension";

suite("showReloadExtensionNotification()", async function () {
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");
    const mockedVSCodeCommands = mockGlobalObject(vscode, "commands");

    test("displays a warning message asking the user if they would like to reload the window", async () => {
        mockedVSCodeWindow.showWarningMessage.resolves(undefined);

        await showReloadExtensionNotification("Want to reload?");

        expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWithExactly(
            "Want to reload?",
            "Reload Extensions"
        );
        expect(mockedVSCodeCommands.executeCommand).to.not.have.been.called;
    });

    test("reloads the extension if the user clicks the 'Reload Extensions' button", async () => {
        mockedVSCodeWindow.showWarningMessage.resolves("Reload Extensions" as any);

        await showReloadExtensionNotification("Want to reload?");

        expect(mockedVSCodeCommands.executeCommand).to.have.been.calledOnceWithExactly(
            "workbench.action.reloadWindow"
        );
    });

    test("can be configured to display additional buttons that the user can click", async () => {
        mockedVSCodeWindow.showWarningMessage.resolves("Ignore" as any);

        await expect(
            showReloadExtensionNotification("Want to reload?", "Ignore")
        ).to.eventually.equal("Ignore");

        expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWithExactly(
            "Want to reload?",
            "Reload Extensions",
            "Ignore"
        );
        expect(mockedVSCodeCommands.executeCommand).to.not.have.been.called;
    });
});
