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
import * as path from "path";
import * as fs from "fs/promises";
import { createSwiftTask } from "../tasks/SwiftTaskProvider";
import { WorkspaceContext } from "../WorkspaceContext";
import { Version } from "../utilities/version";
import configuration from "../configuration";

/**
 * Run the active document through the Swift REPL
 */
export async function runSwiftScript(ctx: WorkspaceContext) {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
        return;
    }

    if (!ctx.currentFolder) {
        return;
    }

    // Swift scripts require new swift driver to work on Windows. Swift driver is available
    // from v5.7 of Windows Swift
    if (
        process.platform === "win32" &&
        ctx.currentFolder.swiftVersion.isLessThan(new Version(5, 7, 0))
    ) {
        vscode.window.showErrorMessage(
            "Run Swift Script is unavailable with the legacy driver on Windows."
        );
        return;
    }

    let target: string;

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

        if (!picked) {
            return;
        }
        target = picked.value;
    } else {
        target = defaultVersion;
    }

    let filename = document.fileName;
    let isTempFile = false;
    if (document.isUntitled) {
        // if document hasn't been saved, save it to a temporary file
        isTempFile = true;
        filename = ctx.tempFolder.filename(document.fileName, "swift");
        const text = document.getText();
        await fs.writeFile(filename, text);
    } else {
        // otherwise save document
        await document.save();
    }
    const runTask = createSwiftTask(
        ["-swift-version", target, filename],
        `Run ${filename}`,
        {
            scope: vscode.TaskScope.Global,
            cwd: vscode.Uri.file(path.dirname(filename)),
            presentationOptions: { reveal: vscode.TaskRevealKind.Always, clear: true },
        },
        ctx.currentFolder.toolchain
    );
    await ctx.tasks.executeTaskAndWait(runTask);

    // delete file after running swift
    if (isTempFile) {
        await fs.rm(filename);
    }
}
