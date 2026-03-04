//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";

const toolchainMismatchWarningLookup: Set<string> = new Set();

interface ToolchainMismatchDetectionOptions {
    platform?: NodeJS.Platform;
    toolchainManager?: "xcrun" | "swiftly" | "swiftenv" | "unknown";
}

function hasSwiftlangVersionMismatch(output: string): boolean {
    const versions = new Set<string>();
    const regex = /swiftlang-(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)/gi;
    for (const match of output.matchAll(regex)) {
        versions.add(match[1]);
        if (versions.size > 1) {
            return true;
        }
    }
    return false;
}

/**
 * Best-effort detection for failures caused by mixing Swiftly and Xcode toolchains on macOS.
 */
export function detectSwiftlyXcodeToolchainMismatch(
    output: string,
    options: ToolchainMismatchDetectionOptions = {}
): boolean {
    const platform = options.platform ?? process.platform;
    if (platform !== "darwin") {
        return false;
    }

    const lowerOutput = output.toLowerCase();
    const hasSwiftlyPath =
        lowerOutput.includes(".swiftly/toolchains") ||
        lowerOutput.includes("\\.swiftly\\toolchains");
    const hasXcodePath =
        lowerOutput.includes("xcodedefault.xctoolchain") ||
        lowerOutput.includes("/applications/xcode") ||
        lowerOutput.includes("contents/developer/toolchains");
    const hasVersionMismatchSignal = [
        "different version of the compiler",
        "module was created for",
        "cannot load underlying module",
        "failed to build module",
        "unable to load standard library for target",
        "swift-frontend command failed",
    ].some(indicator => lowerOutput.includes(indicator));
    const hasGeneralFailureSignal =
        lowerOutput.includes("error:") ||
        lowerOutput.includes("fatal error") ||
        lowerOutput.includes("failed");
    const isSwiftlyToolchain = options.toolchainManager === "swiftly";
    const hasMismatchByVersion = hasSwiftlangVersionMismatch(output);

    return (
        (isSwiftlyToolchain || hasSwiftlyPath) &&
        hasXcodePath &&
        (hasVersionMismatchSignal || (hasGeneralFailureSignal && hasMismatchByVersion))
    );
}

/**
 * Shows a targeted warning for likely Swiftly/Xcode toolchain mismatch failures.
 *
 * This is shown at most once per folder for the current extension session.
 */
export function maybeShowSwiftlyXcodeToolchainMismatchWarning(
    output: string,
    folderContext: FolderContext
): boolean {
    if (
        !detectSwiftlyXcodeToolchainMismatch(output, {
            toolchainManager: folderContext.toolchain.manager,
        })
    ) {
        return false;
    }

    const warningKey = folderContext.folder.fsPath;
    if (toolchainMismatchWarningLookup.has(warningKey)) {
        return false;
    }
    toolchainMismatchWarningLookup.add(warningKey);

    const message =
        "Detected a likely Swift toolchain mismatch: Swiftly and Xcode toolchains appear to be from different versions. " +
        "Update your Swiftly toolchain or switch/update Xcode so both toolchains are compatible.";
    void vscode.window
        .showWarningMessage(message, "Select Toolchain", "Open Documentation")
        .then(selection => {
            if (selection === "Select Toolchain") {
                void vscode.commands.executeCommand("swift.selectToolchain");
            } else if (selection === "Open Documentation") {
                void vscode.env.openExternal(
                    vscode.Uri.parse(
                        "https://docs.swift.org/vscode/documentation/userdocs/supported-toolchains"
                    )
                );
            }
        });
    return true;
}
