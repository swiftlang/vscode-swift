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

// TODO cannot work with symlinks using vscode.workspace.fs APIs
// eslint-disable-next-line no-restricted-imports
import { symlink, unlink } from "fs/promises";
import { TemporaryFolder } from "../utilities/tempFolder";
import configuration from "../configuration";
import * as vscode from "vscode";
import { SwiftLogger } from "../logging/SwiftLogger";

/**
 * Warns the user about lack of symbolic link support on Windows. Performs the
 * check in the background to avoid extending extension startup times.
 *
 * @param outputChannel The Swift output channel to log any errors to
 */
export function checkAndWarnAboutWindowsSymlinks(logger: SwiftLogger) {
    if (process.platform === "win32" && configuration.warnAboutSymlinkCreation) {
        void isSymlinkAllowed(logger).then(async canCreateSymlink => {
            if (canCreateSymlink) {
                return;
            }
            const selected = await vscode.window.showWarningMessage(
                "The Swift extension is unable to create symbolic links on your system and some features may not work correctly. Please either enable Developer Mode or allow symlink creation via Windows privileges.",
                "Learn More",
                "Don't Show Again"
            );
            if (selected === "Learn More") {
                return vscode.env.openExternal(
                    vscode.Uri.parse(
                        "https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development"
                    )
                );
            } else if (selected === "Don't Show Again") {
                configuration.warnAboutSymlinkCreation = false;
            }
        });
    }
}

/**
 * Checks to see if the platform allows creating symlinks.
 *
 * @returns whether or not a symlink can be created
 */
export async function isSymlinkAllowed(logger?: SwiftLogger): Promise<boolean> {
    const temporaryFolder = await TemporaryFolder.create();
    return await temporaryFolder.withTemporaryFile("", async testFilePath => {
        const testSymlinkPath = temporaryFolder.filename("symlink-");
        try {
            await symlink(testFilePath, testSymlinkPath, "file");
            await unlink(testSymlinkPath);
            return true;
        } catch (error) {
            logger?.error(error);
            return false;
        }
    });
}
