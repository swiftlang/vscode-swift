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
import { expect } from "chai";
import * as path from "path";
import * as vscode from "vscode";

import { runSwiftScript } from "@src/commands/runSwiftScript";
import { TaskManager } from "@src/tasks/TaskManager";
import { SwiftToolchain } from "@src/toolchain/toolchain";

import { activateExtensionForSuite, findWorkspaceFolder } from "../utilities/testutilities";

suite("Swift Scripts Suite", () => {
    let document: vscode.TextDocument;
    let tasks: TaskManager;
    let toolchain: SwiftToolchain;

    activateExtensionForSuite({
        async setup(ctx) {
            if (process.platform === "win32") {
                // Swift Scripts on Windows give a JIT error in CI.
                this.skip();
            }

            tasks = ctx.tasks;
            toolchain = ctx.globalToolchain;

            const folder = findWorkspaceFolder("scripts", ctx);
            if (!folder) {
                throw new Error("Could not find 'scripts' workspace folder");
            }
            const scriptPath = path.join(folder.folder.fsPath, "SwiftScript.swift");
            const editor = await vscode.window.showTextDocument(vscode.Uri.file(scriptPath));
            document = editor.document;
        },
        testAssets: ["scripts"],
    });

    test("Successfully runs a swift script", async () => {
        let output = "";
        const exitCode = await runSwiftScript(document, tasks, toolchain, data => (output += data));
        expect(output).to.contain("Hello World");
        expect(exitCode).to.be.equal(0);
    });
});
