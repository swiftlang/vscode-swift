//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2022 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import { WorkspaceContext } from "../../src/WorkspaceContext";
import { getBuildAllTask } from "../../src/tasks/SwiftTaskProvider";
import { SwiftExecution } from "../../src/tasks/SwiftExecution";
import { activateExtensionForTest } from "./utilities/testutilities";
import { expect } from "chai";

suite("Extension Test Suite", function () {
    this.timeout(60000);
    let workspaceContext: WorkspaceContext;

    activateExtensionForTest({
        async setup(ctx) {
            workspaceContext = ctx;
        },
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

    suite("Workspace", function () {
        this.timeout(60000);
        /** Verify tasks.json is being loaded */
        test("Tasks.json", async () => {
            const folder = workspaceContext.folders.find(f => f.name === "test/defaultPackage");
            assert(folder);
            const buildAllTask = await getBuildAllTask(folder);
            const execution = buildAllTask.execution as SwiftExecution;
            expect(buildAllTask.definition.type).to.equal("swift");
            expect(buildAllTask.name).to.include("Build All (defaultPackage)");
            for (const arg of ["build", "--build-tests", "--verbose"]) {
                assert(execution?.args.find(item => item === arg));
            }
        }).timeout(60000);
    });
});
