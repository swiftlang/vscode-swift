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
import { afterEach } from "mocha";
import * as path from "path";

import { WorkspaceContext } from "@src/WorkspaceContext";
import configuration from "@src/configuration";
import { createBuildAllTask } from "@src/tasks/SwiftTaskProvider";

import {
    activateExtensionForSuite,
    getRootWorkspaceFolder,
    updateSettings,
} from "./utilities/testutilities";

suite("Configuration Test Suite", function () {
    let workspaceContext: WorkspaceContext;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
        },
    });

    let resetSettings: (() => Promise<void>) | undefined;
    afterEach(async () => {
        if (resetSettings) {
            await resetSettings();
        }
    });

    test("Should substitute variables in build task", async function () {
        resetSettings = await updateSettings({
            "swift.buildPath": "${workspaceFolder}/somepath",
        });

        const task = await createBuildAllTask(workspaceContext.folders[0], false);
        expect(task).to.not.be.undefined;
        expect(task.definition.args).to.not.be.undefined;
        const index = task.definition.args.indexOf("--scratch-path");
        expect(task.definition.args[index + 1]).to.equal(
            getRootWorkspaceFolder()?.uri.fsPath + "/somepath"
        );
    });

    test("Should substitute variables in configuration", async function () {
        resetSettings = await updateSettings({
            "swift.buildPath": "${workspaceFolder}${pathSeparator}${workspaceFolderBasename}",
        });

        const basePath = getRootWorkspaceFolder()?.uri.fsPath;
        const baseName = path.basename(basePath ?? "");
        const sep = path.sep;
        expect(configuration.buildPath).to.equal(`${basePath}${sep}${baseName}`);
    });
});
