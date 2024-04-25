//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { showReloadExtensionNotification } from "./ReloadExtension";
import configuration from "../configuration";

export async function downloadToolchain() {
    if (await vscode.env.openExternal(vscode.Uri.parse("https://www.swift.org/install/"))) {
        await showToolchainWarning();
    }
}

export async function selectToolchainFolder() {
    const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: "Select the folder containing swift binaries",
        openLabel: "Select folder",
    });
    if (!selected || selected.length !== 1) {
        return;
    }
    await configuration.setPath(selected[0].fsPath, "prompt");
}

export async function showToolchainWarning(): Promise<void> {
    const selected = await showReloadExtensionNotification(
        "The Swift extension must be reloaded in order to use your new toolchain.",
        "Select Toolchain Folder"
    );
    if (selected === "Select Toolchain Folder") {
        await selectToolchainFolder();
    }
}

export async function showToolchainError(): Promise<void> {
    const selected = await vscode.window.showErrorMessage(
        "Unable to automatically discover your Swift toolchain. Either install a toolchain from Swift.org or provide the path to an existing toolchain.",
        "Download",
        "Select Toolchain Folder"
    );
    if (selected === "Download") {
        await downloadToolchain();
    } else if (selected === "Select Toolchain Folder") {
        await selectToolchainFolder();
    }
}
