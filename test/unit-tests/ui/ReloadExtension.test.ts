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
import { anyString, anything, verify, when } from "ts-mockito";
import { equal } from "assert";
import { showReloadExtensionNotification } from "../../../src/ui/ReloadExtension";
import * as vscode from "vscode";
import { mockNamespace } from "../MockUtils";

suite("ReloadExtension Unit Test Suite", async function () {
    const windowMock = mockNamespace(vscode, "window");
    const commandsMock = mockNamespace(vscode, "commands");

    test("Shows user a warning", async () => {
        // No behaviour setup, let's just check if we showed them the notification
        await showReloadExtensionNotification("Want to reload?");
        verify(windowMock.showWarningMessage("Want to reload?", "Reload Extensions")).called();
    });

    test('"Reload Extensions" is clicked', async () => {
        // What happens if they click this button?
        when(windowMock.showWarningMessage(anyString(), "Reload Extensions")).thenReturn(
            Promise.resolve("Reload Extensions")
        );
        await showReloadExtensionNotification("Want to reload?");
        verify(commandsMock.executeCommand("workbench.action.reloadWindow")).called();
    });

    test("Provide a different button", async () => {
        // What if we provide another option?
        when(
            windowMock.showWarningMessage("Want to reload?", "Reload Extensions", "Ignore")
        ).thenReturn(Promise.resolve("Ignore"));
        const result = await showReloadExtensionNotification("Want to reload?", "Ignore");
        equal(result, "Ignore");
        verify(commandsMock.executeCommand(anything())).never();
    });
});
