//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as assert from "assert";
import * as fs from "fs/promises";
import * as swiftExtension from "../../src/extension";
import { FolderEvent, WorkspaceContext } from "../../src/WorkspaceContext";
import { testAssetPath } from "../fixtures";

suite("Extension Test Suite", () => {
    let workspaceContext: WorkspaceContext;

    suiteSetup(async () => {
        const ext = vscode.extensions.getExtension<swiftExtension.Api>("sswg.swift-lang")!;
        const api = await ext.activate();
        workspaceContext = api.workspaceContext;
    });

    suite("Temporary Folder Test Suite", () => {
        test("Create/Delete File", async () => {
            const fileContents = "Test file";
            //const tempFolder = await TemporaryFolder.create();
            const fileName = workspaceContext.tempFolder.filename("test");
            assert.doesNotThrow(async () => await fs.writeFile(fileName, fileContents));
            assert.doesNotThrow(async () => {
                const contents = await fs.readFile(fileName, "utf8");
                assert.strictEqual(contents, fileContents);
            });
            assert.doesNotThrow(async () => await fs.rm(fileName));
        });
    });

    suite("Workspace", () => {
        // test adding FolderContext based on active file
        test("Active Document", async () => {
            let addedPackage: string | undefined;
            const observer = workspaceContext.observeFolders((folder, operation) => {
                assert(folder !== null);
                assert.strictEqual(folder.swiftPackage.name, "package2");
                switch (operation) {
                    case FolderEvent.add:
                        addedPackage = folder.name;
                        break;
                }
            });
            // This makes sure that we set the focus on the opened files which then
            // adds the related package
            await vscode.commands.executeCommand(
                "workbench.action.quickOpen",
                testAssetPath("package2/Sources/package2/package2.swift")
            );
            await sleep(500);

            await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
            await sleep(1000);

            assert.strictEqual(addedPackage, "test/package2");
            observer.dispose();
        });
    });
}).timeout(5000);

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
