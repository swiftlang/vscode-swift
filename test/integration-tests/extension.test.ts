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
import { beforeEach, afterEach } from "mocha";
import { WorkspaceContext } from "../../src/WorkspaceContext";
import { getBuildAllTask } from "../../src/tasks/SwiftTaskProvider";
import { SwiftExecution } from "../../src/tasks/SwiftExecution";
import { activateExtension, deactivateExtension } from "./utilities/testutilities";

suite("Extension Test Suite", () => {
    let workspaceContext: WorkspaceContext;

    beforeEach(async function () {
        workspaceContext = await activateExtension(this.currentTest);
    });

    afterEach(async () => {
        await deactivateExtension();
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
            const folder = workspaceContext.folders.find(f => f.name === "test/defaultPackage");
            assert(folder);
            const buildAllTask = await getBuildAllTask(folder);
            const execution = buildAllTask.execution as SwiftExecution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "swift: Build All (defaultPackage)");
            for (const arg of ["build", "--build-tests", "--verbose"]) {
                assert(execution?.args.find(item => item === arg));
            }
        });
    });
}).timeout(15000);
