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
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";

import { mockGlobalObject } from "../../MockUtils";
import { tag } from "../../tags";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

tag("small").suite("Create Documentation Catalog Command", function () {
    let folderContext: FolderContext;
    let workspaceContext: WorkspaceContext;
    let windowMock: ReturnType<typeof mockGlobalObject>;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            folderContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
            await workspaceContext.focusFolder(folderContext);
        },
    });

    setup(() => {
        windowMock = mockGlobalObject(vscode, "window");
    });

    teardown(() => {
        windowMock.restore();
    });

    test("creates a DocC catalog for a SwiftPM target", async () => {
        let selectedTargetLabel: string | undefined;

        windowMock.showQuickPick.callsFake(
            async (itemsOrPromise: vscode.QuickPickItem[] | Thenable<vscode.QuickPickItem[]>) => {
                const items = await Promise.resolve(itemsOrPromise);
                const target = items.find(item => item.label.startsWith("Target:"));
                selectedTargetLabel = target?.label;
                return target;
            }
        );

        // This path must not prompt for a module name
        windowMock.showInputBox.rejects(new Error("showInputBox should not be called"));

        await vscode.commands.executeCommand("swift.createDocumentationCatalog");

        const basePath = folderContext.folder.fsPath;
        const moduleName = selectedTargetLabel!.replace("Target: ", "");
        const doccDir = path.join(basePath, `${moduleName}.docc`);
        const markdownFile = path.join(doccDir, `${moduleName}.md`);

        expect(await fs.stat(doccDir)).to.exist;
        expect(await fs.stat(markdownFile)).to.exist;

        const contents = await fs.readFile(markdownFile, "utf8");
        expect(contents).to.contain(`# ${moduleName}`);
    });

    test("creates a standalone DocC catalog when no SwiftPM target is selected", async () => {
        windowMock.showQuickPick.resolves(undefined);
        windowMock.showInputBox.resolves("StandaloneModule");

        await vscode.commands.executeCommand("swift.createDocumentationCatalog");

        const basePath = folderContext.folder.fsPath;
        const moduleName = "StandaloneModule";
        const doccDir = path.join(basePath, `${moduleName}.docc`);
        const markdownFile = path.join(doccDir, `${moduleName}.md`);

        expect(await fs.stat(doccDir)).to.exist;
        expect(await fs.stat(markdownFile)).to.exist;

        const contents = await fs.readFile(markdownFile, "utf8");
        expect(contents).to.contain(`# ${moduleName}`);
    });
});
