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

/**
 * Run the active document through the Swift REPL
 */
export async function runSwiftScript(ctx: WorkspaceContext) {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
        return;
    }

    // Swift scripts require new swift driver to work on Windows. Swift driver is available
    // from v5.7 of Windows Swift
    if (
        process.platform === "win32" &&
        ctx.toolchain.swiftVersion.isLessThan(new Version(5, 7, 0))
    ) {
        vscode.window.showErrorMessage(
            "Run Swift Script is unavailable with the legacy driver on Windows."
        );
        return;
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
        [filename],
        `Run ${filename}`,
        {
            scope: vscode.TaskScope.Global,
            cwd: vscode.Uri.file(path.dirname(filename)),
            presentationOptions: { reveal: vscode.TaskRevealKind.Always, clear: true },
        },
        ctx.toolchain
    );
    await ctx.tasks.executeTaskAndWait(runTask);

    // delete file after running swift
    if (isTempFile) {
        await fs.rm(filename);
    }
}
