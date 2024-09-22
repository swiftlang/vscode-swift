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
import { showReloadExtensionNotification } from "../../../src/ui/ReloadExtension";
import * as vscode from "vscode";
import { mockGlobalObject } from "../MockUtils";

suite("ReloadExtension Unit Test Suite", async function () {
    const windowMock = mockGlobalObject(vscode, "window");
    const commandsMock = mockGlobalObject(vscode, "commands");

    test("Shows user a warning", async () => {
        // No behaviour setup, let's just check if we showed them the notification
        await showReloadExtensionNotification("Want to reload?");
        expect(windowMock.showWarningMessage).to.have.been.calledWith(
            "Want to reload?",
            "Reload Extensions"
        );
    });

    test('"Reload Extensions" is clicked', async () => {
        // What happens if they click this button?
        windowMock.showWarningMessage.resolves("Reload Extensions" as any);
        await showReloadExtensionNotification("Want to reload?");
        expect(commandsMock.executeCommand).to.have.been.calledWith(
            "workbench.action.reloadWindow"
        );
    });

    test("Provide a different button", async () => {
        // What if we provide another option?
        windowMock.showWarningMessage.resolves("Ignore" as any);
        await expect(
            showReloadExtensionNotification("Want to reload?", "Ignore")
        ).to.eventually.equal("Ignore");
        expect(commandsMock.executeCommand).to.not.have.been.called;
    });
});
