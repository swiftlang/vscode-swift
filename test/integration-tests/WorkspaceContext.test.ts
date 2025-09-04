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
import { afterEach } from "mocha";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { FolderOperation, WorkspaceContext } from "@src/WorkspaceContext";
import { SwiftExecution } from "@src/tasks/SwiftExecution";
import { createBuildAllTask } from "@src/tasks/SwiftTaskProvider";
import { resolveScope } from "@src/utilities/tasks";
import { Version } from "@src/utilities/version";

import { testAssetUri } from "../fixtures";
import { tag } from "../tags";
import { assertContains } from "./testexplorer/utilities";
import {
    activateExtensionForSuite,
    getRootWorkspaceFolder,
    updateSettings,
} from "./utilities/testutilities";

function assertContainsArg(execution: SwiftExecution, arg: string) {
    assert(execution?.args.find(a => a === arg));
}

function assertNotContainsArg(execution: SwiftExecution, arg: string) {
    assert.equal(
        execution?.args.find(a => a.includes(arg)),
        undefined
    );
}

tag("medium").suite("WorkspaceContext Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    const packageFolder: vscode.Uri = testAssetUri("defaultPackage");

    suite("Folder Events", () => {
        activateExtensionForSuite({
            async setup(ctx) {
                workspaceContext = ctx;
            },
            // No default assets as we want to verify against a clean workspace.
            testAssets: ["defaultPackage"],
        });

        test("Add", async () => {
            let observer: vscode.Disposable | undefined;
            const recordedFolders: {
                folder: FolderContext | null;
                operation: FolderOperation;
            }[] = [];

            try {
                observer = workspaceContext.onDidChangeFolders(changedFolderRecord => {
                    recordedFolders.push(changedFolderRecord);
                });

                const workspaceFolder = getRootWorkspaceFolder();

                assert.ok(workspaceFolder, "No workspace folders found in workspace");

                await workspaceContext.addPackageFolder(testAssetUri("package2"), workspaceFolder);

                const foldersNamePromises = recordedFolders
                    .map(({ folder }) => folder?.swiftPackage.name)
                    .filter(f => !!f);
                const foldersNames = await Promise.all(foldersNamePromises);
                assertContains(foldersNames, "package2");

                const addedCount = recordedFolders.filter(
                    ({ operation }) => operation === FolderOperation.add
                ).length;
                assert.strictEqual(
                    addedCount,
                    1,
                    `Expected only one add folder operation, instead got folders: ${recordedFolders.map(folder => folder.folder?.name)}`
                );
            } finally {
                observer?.dispose();
            }
        });
    });

    suite("Tasks", function () {
        activateExtensionForSuite({
            async setup(ctx) {
                workspaceContext = ctx;
            },
        });

        let resetSettings: (() => Promise<void>) | undefined;
        afterEach(async () => {
            if (resetSettings) {
                await resetSettings();
                resetSettings = undefined;
            }
        });

        test("Default Task values", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            resetSettings = await updateSettings({
                "swift.diagnosticsStyle": "",
            });
            const buildAllTask = await createBuildAllTask(folder);
            const execution = buildAllTask.execution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "Build All (defaultPackage)");
            assertContainsArg(execution, "build");
            assertContainsArg(execution, "--build-tests");
            assert.strictEqual(buildAllTask.scope, resolveScope(folder.workspaceFolder));
        });

        test('"default" diagnosticsStyle', async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            resetSettings = await updateSettings({
                "swift.diagnosticsStyle": "default",
            });
            const buildAllTask = await createBuildAllTask(folder);
            const execution = buildAllTask.execution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "Build All (defaultPackage)");
            assertContainsArg(execution, "build");
            assertContainsArg(execution, "--build-tests");
            assertNotContainsArg(execution, "-diagnostic-style");
            assert.strictEqual(buildAllTask.scope, resolveScope(folder.workspaceFolder));
        });

        test('"swift" diagnosticsStyle', async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            resetSettings = await updateSettings({
                "swift.diagnosticsStyle": "swift",
            });
            const buildAllTask = await createBuildAllTask(folder);
            const execution = buildAllTask.execution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "Build All (defaultPackage)");
            assertContainsArg(execution, "build");
            assertContainsArg(execution, "--build-tests");
            assertContainsArg(execution, "-Xswiftc");
            assertContainsArg(execution, "-diagnostic-style=swift");
            assert.strictEqual(buildAllTask.scope, resolveScope(folder.workspaceFolder));
        });

        test("Build Settings", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            resetSettings = await updateSettings({
                "swift.diagnosticsStyle": "",
                "swift.buildArguments": ["--sanitize=thread"],
            });
            const buildAllTask = await createBuildAllTask(folder);
            const execution = buildAllTask.execution as SwiftExecution;
            assertContainsArg(execution, "--sanitize=thread");
        });

        test("Package Arguments Settings", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            resetSettings = await updateSettings({
                "swift.diagnosticsStyle": "",
                "swift.packageArguments": ["--replace-scm-with-registry"],
            });
            const buildAllTask = await createBuildAllTask(folder);
            const execution = buildAllTask.execution as SwiftExecution;
            assertContainsArg(execution, "--replace-scm-with-registry");
        });
    });

    suite("Toolchain", function () {
        activateExtensionForSuite({
            async setup(ctx) {
                workspaceContext = ctx;
            },
        });

        tag("small").test("get project templates", async () => {
            // This is only supported in swift versions >=5.8.0
            const swiftVersion = workspaceContext.globalToolchain.swiftVersion;
            if (swiftVersion.isLessThan(new Version(5, 8, 0))) {
                assert.deepEqual(await workspaceContext.globalToolchain.getProjectTemplates(), []);
                return;
            }
            // The output of `swift package init --help` will probably change at some point.
            // Just make sure that the most complex portions of the output are parsed correctly.
            const projectTemplates = await workspaceContext.globalToolchain.getProjectTemplates();
            // Contains multi-line description
            const toolTemplate = projectTemplates.find(template => template.id === "tool");
            assert(toolTemplate);
            assert.deepEqual(toolTemplate, {
                id: "tool",
                name: "Tool",
                description:
                    "A package with an executable that uses Swift Argument Parser. Use this template if you plan to have a rich set of command-line arguments.",
            });
            // build-tool-plugin is only available in swift versions >=5.9.0
            if (swiftVersion.isLessThan(new Version(5, 9, 0))) {
                return;
            }
            // Name conversion includes dashes
            const buildToolPluginTemplate = projectTemplates.find(
                t => t.id === "build-tool-plugin"
            );
            assert(buildToolPluginTemplate);
            assert.deepEqual(buildToolPluginTemplate, {
                id: "build-tool-plugin",
                name: "Build Tool Plugin",
                description: "A package that vends a build tool plugin.",
            });
        });
    });
});
