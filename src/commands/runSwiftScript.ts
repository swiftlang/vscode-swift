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
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import configuration from "../configuration";
import { createSwiftTask } from "../tasks/SwiftTaskProvider";
import { TaskManager } from "../tasks/TaskManager";
import { SwiftToolchain } from "../toolchain/toolchain";
import { TemporaryFolder } from "../utilities/tempFolder";

/**
 * Runs the Swift code in the supplied document.
 *
 * This function checks for a valid document and Swift version, then creates and executes
 * a Swift task to run the script file. The task is configured to always reveal its output
 * and clear previous output. The working directory is set to the script's location.
 *
 * @param document - The text document containing the Swift script to run. If undefined, the function returns early.
 * @param tasks - The TaskManager instance used to execute and manage the Swift task.
 * @param toolchain - The SwiftToolchain to use for running the script.
 * @returns A promise that resolves when the script has finished running, or returns early if the user is prompted
 * for which swift version to use and they exit the dialog without choosing one.
 */
export async function runSwiftScript(
    document: vscode.TextDocument,
    tasks: TaskManager,
    toolchain: SwiftToolchain
) {
    const targetVersion = await targetSwiftVersion();
    if (!targetVersion) {
        return;
    }

    await withDocumentFile(document, async filename => {
        const runTask = createSwiftTask(
            ["-swift-version", targetVersion, filename],
            `Run ${filename}`,
            {
                scope: vscode.TaskScope.Global,
                cwd: vscode.Uri.file(path.dirname(filename)),
                presentationOptions: { reveal: vscode.TaskRevealKind.Always, clear: true },
            },
            toolchain
        );
        await tasks.executeTaskAndWait(runTask);
    });
}

/**
 * Determines the target Swift language version to use for script execution.
 * If the configuration is set to "Ask Every Run", prompts the user to select a version.
 * Otherwise, returns the default version from the user's settings.
 *
 * @returns {Promise<string | undefined>} The selected Swift version, or undefined if no selection was made.
 */
async function targetSwiftVersion() {
    const defaultVersion = configuration.scriptSwiftLanguageVersion;
    if (defaultVersion === "Ask Every Run") {
        const picked = await vscode.window.showQuickPick(
            [
                // Potentially add more versions here
                { value: "5", label: "Swift 5" },
                { value: "6", label: "Swift 6" },
            ],
            {
                placeHolder: "Select a target Swift version",
            }
        );
        return picked?.value;
    } else {
        return defaultVersion;
    }
}

/**
 * Executes a callback with the filename of the given `vscode.TextDocument`.
 * If the document is untitled (not yet saved to disk), it creates a temporary file,
 * writes the document's content to it, and passes its filename to the callback.
 * Otherwise, it ensures the document is saved and passes its actual filename.
 *
 * The temporary file is automatically deleted when the callback completes.
 *
 * @param document - The VSCode text document to operate on.
 * @param callback - An async function that receives the filename of the document or temporary file.
 * @returns A promise that resolves when the callback has completed.
 */
async function withDocumentFile(
    document: vscode.TextDocument,
    callback: (filename: string) => Promise<void>
) {
    if (document.isUntitled) {
        const tmpFolder = await TemporaryFolder.create();
        await tmpFolder.withTemporaryFile("swift", async filename => {
            await fs.writeFile(filename, document.getText());
            await callback(filename);
        });
    } else {
        await document.save();
        await callback(document.fileName);
    }
}
