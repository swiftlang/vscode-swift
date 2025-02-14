//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import {
    DarwinCompatibleTarget,
    SwiftToolchain,
    getDarwinTargetTriple,
} from "../toolchain/toolchain";
import configuration from "../configuration";
import { Version } from "../utilities/version";
import { WorkspaceContext } from "../WorkspaceContext";

/**
 * Switches the appropriate SDK setting to the platform selected in a QuickPick UI.
 */
export async function switchPlatform(ctx: WorkspaceContext) {
    const picked = await vscode.window.showQuickPick(
        [
            { value: undefined, label: "macOS" },
            { value: DarwinCompatibleTarget.iOS, label: "iOS" },
            { value: DarwinCompatibleTarget.tvOS, label: "tvOS" },
            { value: DarwinCompatibleTarget.watchOS, label: "watchOS" },
            { value: DarwinCompatibleTarget.visionOS, label: "visionOS" },
        ],
        {
            placeHolder: "Select a new target platform",
        }
    );
    if (picked) {
        if (ctx.toolchain.swiftVersion.isLessThan(new Version(6, 1, 0))) {
            vscode.window.showWarningMessage(
                "Code editing support for non-macOS platforms is only available starting Swift 6.1"
            );
        }
        // show a status item as getSDKForTarget can sometimes take a long while to xcrun for the SDK
        const statusItemText = `Setting target platform to ${picked.label}`;
        ctx.statusItem.start(statusItemText);
        try {
            if (picked.value) {
                // verify that the SDK for the platform actually exists
                await SwiftToolchain.getSDKForTarget(picked.value);
            }
            const swiftSDKTriple = picked.value ? getDarwinTargetTriple(picked.value) : "";
            if (swiftSDKTriple !== "") {
                // set a swiftSDK for non-macOS Darwin platforms so that SourceKit-LSP can provide syntax highlighting
                configuration.swiftSDK = swiftSDKTriple;
                vscode.window.showWarningMessage(
                    `Selecting the ${picked.label} target platform will provide code editing support, but compiling with a ${picked.label} SDK will have undefined results.`
                );
            } else {
                // set swiftSDK to undefined for macOS and other platforms
                configuration.swiftSDK = undefined;
            }
        } catch {
            vscode.window.showErrorMessage(
                `Unable set the Swift SDK setting to ${picked.label}, verify that the SDK exists`
            );
        }
        ctx.statusItem.end(statusItemText);
    }
}
