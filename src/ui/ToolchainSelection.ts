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

/**
 * Open the installation page on Swift.org
 */
export async function downloadToolchain() {
    if (await vscode.env.openExternal(vscode.Uri.parse("https://www.swift.org/install/"))) {
        const selected = await showReloadExtensionNotification(
            "The Swift extension must be reloaded in order to use your new toolchain.",
            "Select Toolchain Folder"
        );
        if (selected === "Select Toolchain Folder") {
            await selectToolchainFolder();
        }
    }
}

/**
 * Prompt the user to select a folder where they have installed the swift toolchain.
 * Updates the swift.path configuration with the selected folder.
 */
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

/** A {@link vscode.QuickPickItem} that contains the path to an installed swift toolchain */
interface SwiftToolchainItem extends vscode.QuickPickItem {
    type: "toolchain";
    toolchainPath: string;
    swiftFolderPath: string;
}

/** A {@link vscode.QuickPickItem} that performs an action for the user */
interface ActionItem extends vscode.QuickPickItem {
    type: "action";
    run(): Promise<void>;
}

/** A {@link vscode.QuickPickItem} that separates items in the UI */
class SeparatorItem implements vscode.QuickPickItem {
    readonly type = "separator";
    readonly kind = vscode.QuickPickItemKind.Separator;
    readonly label: string;

    constructor(label: string) {
        this.label = label;
    }
}

/** The possible types of {@link vscode.QuickPickItem} in the toolchain selection dialog */
type SelectToolchainItem = SwiftToolchainItem | ActionItem | SeparatorItem;

/**
 * Retrieves all {@link SelectToolchainItem} that are available on the system.
 *
 * @param ctx the {@link WorkspaceContext}
 * @returns an array of {@link SelectToolchainItem}
 */
async function getQuickPickItems(
    ctx: WorkspaceContext | undefined
): Promise<SelectToolchainItem[]> {
    const xcodes = (await SwiftToolchain.getXcodeInstalls())
        .reverse()
        .map<SwiftToolchainItem>(xcodePath => {
            const toolchainPath = path.join(
                xcodePath,
                "Contents",
                "Developer",
                "Toolchains",
                "XcodeDefault.xctoolchain",
                "usr"
            );
            return {
                type: "toolchain",
                label: path.basename(xcodePath, ".app"),
                detail: xcodePath,
                toolchainPath,
                swiftFolderPath: path.join(toolchainPath, "bin"),
            };
        });
    const toolchains = (await SwiftToolchain.getToolchainInstalls())
        .reverse()
        .map<SwiftToolchainItem>(toolchainPath => ({
            type: "toolchain",
            label: path.basename(toolchainPath, ".xctoolchain"),
            detail: toolchainPath,
            toolchainPath: path.join(toolchainPath, "usr"),
            swiftFolderPath: path.join(toolchainPath, "usr", "bin"),
        }));
    const swiftlyToolchains = (await SwiftToolchain.getSwiftlyToolchainInstalls())
        .reverse()
        .map<SwiftToolchainItem>(toolchainPath => ({
            type: "toolchain",
            label: path.basename(toolchainPath),
            detail: toolchainPath,
            toolchainPath: path.join(toolchainPath, "usr"),
            swiftFolderPath: path.join(toolchainPath, "usr", "bin"),
        }));
    if (ctx) {
        const toolchainInUse = [...xcodes, ...toolchains, ...swiftlyToolchains].find(toolchain => {
            return ctx.toolchain?.toolchainPath.startsWith(toolchain.toolchainPath);
        });
        if (toolchainInUse) {
            toolchainInUse.description = "$(check) in use";
        } else {
            toolchains.splice(0, 0, {
                type: "toolchain",
                label: `Swift ${ctx.toolchain.swiftVersion.toString()}`,
                description: "$(check) in use",
                detail: ctx.toolchain.toolchainPath,
                toolchainPath: ctx.toolchain.toolchainPath,
                swiftFolderPath: ctx.toolchain.swiftFolderPath,
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

/**
 * Prompt the user to select or install a swift toolchain. Updates the swift.path configuration
 * with the user's selection.
 *
 * @param ctx the {@link WorkspaceContext}
 */
export async function selectToolchain(ctx: WorkspaceContext | undefined) {
    const selected = await vscode.window.showQuickPick<SelectToolchainItem>(
        getQuickPickItems(ctx),
        {
            title: "Select the Swift toolchain",
            placeHolder: "Pick a Swift toolchain",
            canPickMany: false,
        }
    );
    if (selected?.type === "action") {
        await selected.run();
    } else if (selected?.type === "toolchain") {
        await configuration.setPath(selected.swiftFolderPath, "prompt");
    }
}
