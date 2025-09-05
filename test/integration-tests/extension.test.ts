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
import { expect } from "chai";
import * as vscode from "vscode";

import { WorkspaceContext } from "@src/WorkspaceContext";
import { SwiftExecution } from "@src/tasks/SwiftExecution";
import { getBuildAllTask } from "@src/tasks/SwiftTaskProvider";

import { activateExtensionForTest, findWorkspaceFolder } from "./utilities/testutilities";

suite("Extension Test Suite", function () {
    let workspaceContext: WorkspaceContext;

    activateExtensionForTest({
        async setup(ctx) {
            workspaceContext = ctx;
        },
    });

    suite("Workspace", function () {
        /** Verify tasks.json is being loaded */
        test("Tasks.json", async () => {
            const folder = findWorkspaceFolder("defaultPackage", workspaceContext);
            assert.ok(folder);
            const buildAllTask = await getBuildAllTask(folder);
            const execution = buildAllTask.execution as SwiftExecution;
            expect(buildAllTask.definition.type).to.equal("swift");
            expect(buildAllTask.name).to.include(
                "Build All (defaultPackage)" +
                    (vscode.workspace.workspaceFile ? " (workspace)" : "")
            );
            for (const arg of ["build", "--build-tests", "--verbose"].concat([
                vscode.workspace.workspaceFile ? "-DBAR" : "-DFOO",
            ])) {
                assert.ok(execution?.args.find(item => item === arg));
            }
        });
    });
});
