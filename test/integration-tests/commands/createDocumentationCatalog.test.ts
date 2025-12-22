//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { expect } from "chai";
import * as fs from "fs/promises";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";

import { tag } from "../../tags";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

tag("small").suite("Create Documentation Catalog Command", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
            await workspaceContext.focusFolder(folderContext);
        },
    });

    test("creates a DocC catalog for a SwiftPM target", async () => {
        const quickPickStub = sinon.stub(vscode.window, "showQuickPick");
        const inputBoxStub = sinon.stub(vscode.window, "showInputBox");

        try {
            inputBoxStub.resolves("MyModule");
            quickPickStub.callsFake(async itemsOrPromise => {
                const items = await Promise.resolve(itemsOrPromise);
                return items.find(item => item.label.startsWith("Target:"));
            });

            await vscode.commands.executeCommand("swift.createDocumentationCatalog");

            const basePath = folderContext.folder.fsPath;
            const doccDir = path.join(basePath, "MyModule.docc");
            const markdownFile = path.join(doccDir, "MyModule.md");

            expect(await fs.stat(doccDir)).to.exist;
            expect(await fs.stat(markdownFile)).to.exist;

            const contents = await fs.readFile(markdownFile, "utf8");
            expect(contents).to.contain("# MyModule");
        } finally {
            quickPickStub.restore();
            inputBoxStub.restore();
        }
    });
});
