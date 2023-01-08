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
import { WorkspaceContext } from "../../src/WorkspaceContext";
import { testAssetPath } from "../fixtures";
import { getBuildAllTask } from "../../src/SwiftTaskProvider";

/*suite("Extension Test Suite", () => {
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
        }).timeout(5000);
    });

    suite("Workspace", () => {
        // test adding FolderContext based on active file
        test("Active Document", async () => {
            // This makes sure that we set the focus on the opened files which then
            // adds the related package
            await vscode.commands.executeCommand(
                "workbench.action.quickOpen",
                testAssetPath("package2/Sources/package2/package2.swift")
            );
            await sleep(500);

            await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");

            // wait for results (allow for 7 seconds), check result every 100ms
            let i = 0;
            while (i < 70) {
                await sleep(100);
                if (workspaceContext.currentFolder) {
                    assert.strictEqual(workspaceContext.currentFolder.name, "test/package2");
                    break;
                }
                i++;
            }
            assert.notStrictEqual(i, 70);
        }).timeout(10000);

        test("Tasks.json", async () => {
            const folder = workspaceContext.folders.find(f => f.name === "test/package2");
            assert(folder);
            const buildAllTask = await getBuildAllTask(folder);
            const execution = buildAllTask.execution as vscode.ShellExecution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "Build All (package2)");
            assert.notStrictEqual(execution?.args, ["build", "--build-tests", "--verbose"]);
        });
    });
});

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
*/
