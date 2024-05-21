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
import * as swiftExtension from "../../src/extension";
import { WorkspaceContext } from "../../src/WorkspaceContext";
import { testAssetUri } from "../fixtures";
import { getBuildAllTask } from "../../src/tasks/SwiftTaskProvider";
import { SwiftExecution } from "../../src/tasks/SwiftExecution";

export const globalWorkspaceContextPromise = new Promise<WorkspaceContext>(resolve => {
    const ext = vscode.extensions.getExtension<swiftExtension.Api>("sswg.swift-lang")!;
    ext.activate()
        .then(api => {
            const packageFolder = testAssetUri("defaultPackage");
            const workspaceFolder = vscode.workspace.workspaceFolders?.values().next().value;
            return api.workspaceContext.addPackageFolder(packageFolder, workspaceFolder);
        })
        .then(folder => {
            resolve(folder.workspaceContext);
        });
});

suite("Extension Test Suite", () => {
    let workspaceContext: WorkspaceContext;

    suiteSetup(async () => {
        workspaceContext = await globalWorkspaceContextPromise;
    });

    suite("Temporary Folder Test Suite", () => {
        /*test("Create/Delete File", async () => {
            const fileContents = "Test file";
            //const tempFolder = await TemporaryFolder.create();
            const fileName = workspaceContext.tempFolder.filename("test");
            assert.doesNotThrow(async () => await fs.writeFile(fileName, fileContents));
            assert.doesNotThrow(async () => {
                const contents = await fs.readFile(fileName, "utf8");
                assert.strictEqual(contents, fileContents);
            });
            assert.doesNotThrow(async () => await fs.rm(fileName));
        }).timeout(5000);*/
    });

    suite("Workspace", () => {
        /** Verify tasks.json is being loaded */
        test("Tasks.json", async () => {
            // Skip if running CI as it takes too long
            if (process.env.CI) {
                return;
            }
            const folder = workspaceContext.folders.find(f => f.name === "test/defaultPackage");
            assert(folder);
            const buildAllTask = await getBuildAllTask(folder);
            const execution = buildAllTask.execution as SwiftExecution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "swift: Build All (defaultPackage)");
            for (const arg of ["build", "--build-tests", "--verbose"]) {
                assert(execution?.args.find(item => item === arg));
            }
        }).timeout(10000);
    });
}).timeout(15000);
