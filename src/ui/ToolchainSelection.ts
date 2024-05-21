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
import * as path from "path";
import { showReloadExtensionNotification } from "./ReloadExtension";
import configuration from "../configuration";
import { WorkspaceContext } from "../WorkspaceContext";
import { SwiftToolchain } from "../toolchain/toolchain";

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

interface XcodeItem extends vscode.QuickPickItem {
    type: "xcode";
    path: string;
}

interface SwiftToolchainItem extends vscode.QuickPickItem {
    type: "toolchain";
    path: string;
}

interface ActionItem extends vscode.QuickPickItem {
    type: "action";
    run(): Promise<void>;
}

class SeparatorItem implements vscode.QuickPickItem {
    readonly type = "separator";
    readonly kind = vscode.QuickPickItemKind.Separator;
    readonly label: string;

    constructor(label: string) {
        this.label = label;
    }
}

type SelectToolchainItem = XcodeItem | SwiftToolchainItem | ActionItem | SeparatorItem;

async function getQuickPickItems(ctx: WorkspaceContext): Promise<SelectToolchainItem[]> {
    const xcodes = (await SwiftToolchain.getXcodeInstalls())
        .sort((a, b) => (a > b ? -1 : 1)) // Reverse order
        .map<XcodeItem>(xcodePath => ({
            type: "xcode",
            label: path.basename(xcodePath, ".app"),
            detail: xcodePath,
            path: xcodePath,
        }));
    const toolchains = (await SwiftToolchain.getToolchainInstalls())
        .sort((a, b) => (a > b ? -1 : 1)) // Reverse order
        .map<SwiftToolchainItem>(toolchainPath => ({
            type: "toolchain",
            label: path.basename(toolchainPath, ".xctoolchain"),
            detail: toolchainPath,
            path: toolchainPath,
        }));
    const swiftlyToolchains = (await SwiftToolchain.getSwiftlyToolchainInstalls())
        .sort((a, b) => (a > b ? -1 : 1)) // Reverse order
        .map<SwiftToolchainItem>(toolchainPath => ({
            type: "toolchain",
            label: path.basename(toolchainPath),
            detail: toolchainPath,
            path: toolchainPath,
        }));
    if (ctx.toolchain) {
        const xcode = xcodes.find(xcode => ctx.toolchain?.toolchainPath.startsWith(xcode.path));
        if (xcode) {
            xcode.description = "$(check) in use";
        }
        const toolchain = toolchains.find(toolchain =>
            ctx.toolchain?.toolchainPath.startsWith(toolchain.path)
        );
        if (toolchain) {
            toolchain.description = "$(check) in use";
        }
        if (!xcode && !toolchain) {
            toolchains.splice(0, 0, {
                type: "toolchain",
                label: `Swift ${ctx.toolchain.swiftVersion.toString()}`,
                description: "$(check) in use",
                detail: ctx.toolchain.toolchainPath,
                path: ctx.toolchain.toolchainPath,
            });
        }
    }
    return [
        ...(xcodes.length > 0 ? [new SeparatorItem("Xcode"), ...xcodes] : []),
        ...(toolchains.length > 0 ? [new SeparatorItem("toolchains"), ...toolchains] : []),
        ...(swiftlyToolchains.length > 0
            ? [new SeparatorItem("swiftly"), ...swiftlyToolchains]
            : []),
        new SeparatorItem("actions"),
        {
            type: "action",
            label: "$(cloud-download) Download from Swift.org...",
            detail: "Open https://swift.org/install/ to download and install a toolchain",
            run: downloadToolchain,
        },
        {
            type: "action",
            label: "$(folder-opened) Select toolchain directory...",
            detail: "Select a folder on your machine where the Swift toolchain is installed",
            run: selectToolchainFolder,
        },
    ];
}

export async function selectToolchain(ctx: WorkspaceContext) {
    const selected = await vscode.window.showQuickPick<SelectToolchainItem>(
        getQuickPickItems(ctx),
        {
            title: "Select the swift toolchain",
            placeHolder: "Pick a swift toolchain",
            canPickMany: false,
        }
    );
    if (selected?.type === "action") {
        await selected.run();
    } else if (selected?.type === "toolchain") {
        await configuration.setPath(selected.path, "prompt");
    } else if (selected?.type === "xcode") {
        await configuration.setPath(
            path.join(
                selected.path,
                "Contents",
                "Developer",
                "Toolchains",
                "XcodeDefault.xctoolchain",
                "usr",
                "bin"
            ),
            "prompt"
        );
    }
}
