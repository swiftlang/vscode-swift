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
            let selectedTargetLabel: string | undefined;

            quickPickStub.callsFake(async itemsOrPromise => {
                const items = await Promise.resolve(itemsOrPromise);
                const target = items.find(item => item.label.startsWith("Target:"));
                selectedTargetLabel = target?.label;
                return target;
            });

            await vscode.commands.executeCommand("swift.createDocumentationCatalog");
            expect(inputBoxStub.called).to.be.false;
            const basePath = folderContext.folder.fsPath;
            const moduleName = selectedTargetLabel!.replace("Target: ", "");
            const doccDir = path.join(basePath, `${moduleName}.docc`);
            const markdownFile = path.join(doccDir, `${moduleName}.md`);

            expect(await fs.stat(doccDir)).to.exist;
            expect(await fs.stat(markdownFile)).to.exist;

            const contents = await fs.readFile(markdownFile, "utf8");
            expect(contents).to.contain("# defaultPackage");
        } finally {
            quickPickStub.restore();
            inputBoxStub.restore();
        }
    });
});
