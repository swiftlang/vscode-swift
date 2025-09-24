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
import { expect } from "chai";
import { afterEach } from "mocha";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { FolderOperation, WorkspaceContext } from "@src/WorkspaceContext";
import { SwiftExecution } from "@src/tasks/SwiftExecution";
import { createBuildAllTask } from "@src/tasks/SwiftTaskProvider";
import { resolveScope } from "@src/utilities/tasks";
import { Version } from "@src/utilities/version";

import { testAssetPath, testAssetUri } from "../fixtures";
import { tag } from "../tags";
import { assertContains } from "./testexplorer/utilities";
import {
    activateExtensionForSuite,
    getRootWorkspaceFolder,
    updateSettings,
} from "./utilities/testutilities";

function assertContainsArg(execution: SwiftExecution, arg: string) {
    expect(execution?.args.find(a => a === arg)).to.not.be.undefined;
}

function assertNotContainsArg(execution: SwiftExecution, arg: string) {
    expect(execution?.args.find(a => a.includes(arg))).to.be.undefined;
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
            let recordedFolders: {
                folder: FolderContext | null;
                operation: FolderOperation;
            }[] = [];

            try {
                observer = workspaceContext.onDidChangeFolders(changedFolderRecord => {
                    recordedFolders.push(changedFolderRecord);
                });

                // https://github.com/swiftlang/vscode-swift/issues/1944
                // make sure get existing folder(s)
                const addedFolders = recordedFolders.filter(
                    ({ operation }) => operation === FolderOperation.add
                );
                let addedCount = addedFolders.length;
                expect(
                    addedCount,
                    `Expected at least one add folder operation, instead got folders: ${addedFolders.map(folder => folder.folder?.name)}`
                ).to.be.greaterThanOrEqual(1);
                console.log(addedFolders.map(folder => folder.folder?.name));
                expect(
                    addedFolders.find(
                        folder => folder?.folder?.folder.fsPath === testAssetPath("defaultPackage")
                    )
                ).to.not.be.undefined;

                const workspaceFolder = getRootWorkspaceFolder();

                expect(workspaceFolder).to.not.be.undefined;

                recordedFolders = [];
                await workspaceContext.addPackageFolder(testAssetUri("package2"), workspaceFolder);

                const foldersNamePromises = recordedFolders
                    .map(({ folder }) => folder?.swiftPackage.name)
                    .filter(f => !!f);
                const foldersNames = await Promise.all(foldersNamePromises);
                assertContains(foldersNames, "package2");

                addedCount = recordedFolders.filter(
                    ({ operation }) => operation === FolderOperation.add
                ).length;
                expect(
                    addedCount,
                    `Expected only one add folder operation, instead got folders: ${recordedFolders.map(folder => folder.folder?.name)}`
                ).to.equal(1);
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
            expect(folder).to.not.be.undefined;
            resetSettings = await updateSettings({
                "swift.diagnosticsStyle": "",
            });
            const buildAllTask = await createBuildAllTask(folder!);
            const execution = buildAllTask.execution;
            expect(buildAllTask.definition.type).to.equal("swift");
            expect(buildAllTask.name).to.equal("Build All (defaultPackage)");
            assertContainsArg(execution, "build");
            assertContainsArg(execution, "--build-tests");
            expect(buildAllTask.scope).to.equal(resolveScope(folder!.workspaceFolder));
        });

        test('"default" diagnosticsStyle', async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            expect(folder).to.not.be.undefined;
            resetSettings = await updateSettings({
                "swift.diagnosticsStyle": "default",
            });
            const buildAllTask = await createBuildAllTask(folder!);
            const execution = buildAllTask.execution;
            expect(buildAllTask.definition.type).to.equal("swift");
            expect(buildAllTask.name).to.equal("Build All (defaultPackage)");
            assertContainsArg(execution, "build");
            assertContainsArg(execution, "--build-tests");
            assertNotContainsArg(execution, "-diagnostic-style");
            expect(buildAllTask.scope).to.equal(resolveScope(folder!.workspaceFolder));
        });

        test('"swift" diagnosticsStyle', async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            expect(folder).to.not.be.undefined;
            resetSettings = await updateSettings({
                "swift.diagnosticsStyle": "swift",
            });
            const buildAllTask = await createBuildAllTask(folder!);
            const execution = buildAllTask.execution;
            expect(buildAllTask.definition.type).to.equal("swift");
            expect(buildAllTask.name).to.equal("Build All (defaultPackage)");
            assertContainsArg(execution, "build");
            assertContainsArg(execution, "--build-tests");
            assertContainsArg(execution, "-Xswiftc");
            assertContainsArg(execution, "-diagnostic-style=swift");
            expect(buildAllTask.scope).to.equal(resolveScope(folder!.workspaceFolder));
        });

        test("Build Settings", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            expect(folder).to.not.be.undefined;
            resetSettings = await updateSettings({
                "swift.diagnosticsStyle": "",
                "swift.buildArguments": ["--sanitize=thread"],
            });
            const buildAllTask = await createBuildAllTask(folder!);
            const execution = buildAllTask.execution as SwiftExecution;
            assertContainsArg(execution, "--sanitize=thread");
        });

        test("Package Arguments Settings", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            expect(folder).to.not.be.undefined;
            resetSettings = await updateSettings({
                "swift.diagnosticsStyle": "",
                "swift.packageArguments": ["--replace-scm-with-registry"],
            });
            const buildAllTask = await createBuildAllTask(folder!);
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
            // The output of `swift package init --help` will probably change at some point.
            // Just make sure that the most complex portions of the output are parsed correctly.
            const projectTemplates = await workspaceContext.globalToolchain.getProjectTemplates();
            // Contains multi-line description
            const toolTemplate = projectTemplates.find(template => template.id === "tool");
            expect(toolTemplate).to.not.be.undefined;
            expect(toolTemplate).to.deep.equal({
                id: "tool",
                name: "Tool",
                description:
                    "A package with an executable that uses Swift Argument Parser. Use this template if you plan to have a rich set of command-line arguments.",
            });
            // build-tool-plugin is only available in swift versions >=5.9.0
            const swiftVersion = workspaceContext.globalToolchain.swiftVersion;
            if (swiftVersion.isLessThan(new Version(5, 9, 0))) {
                return;
            }
            // Name conversion includes dashes
            const buildToolPluginTemplate = projectTemplates.find(
                t => t.id === "build-tool-plugin"
            );
            expect(buildToolPluginTemplate).to.not.be.undefined;
            expect(buildToolPluginTemplate).to.deep.equal({
                id: "build-tool-plugin",
                name: "Build Tool Plugin",
                description: "A package that vends a build tool plugin.",
            });
        });
    });
});
