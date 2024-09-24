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

import * as vscode from "vscode";
import * as assert from "assert";
import { testAssetUri } from "../fixtures";
import { FolderOperation, WorkspaceContext } from "../../src/WorkspaceContext";
import { createBuildAllTask } from "../../src/tasks/SwiftTaskProvider";
import { globalWorkspaceContextPromise } from "./extension.test";
import { Version } from "../../src/utilities/version";
import { SwiftExecution } from "../../src/tasks/SwiftExecution";

suite("WorkspaceContext Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    const packageFolder: vscode.Uri = testAssetUri("defaultPackage");

    suiteSetup(async () => {
        workspaceContext = await globalWorkspaceContextPromise;
    });

    suite("Folder Events", () => {
        test("Add", async () => {
            let count = 0;
            const observer = workspaceContext?.onDidChangeFolders(({ folder, operation }) => {
                assert(folder !== null);
                assert.strictEqual(folder!.swiftPackage.name, "package2");
                switch (operation) {
                    case FolderOperation.add:
                        count++;
                        break;
                }
            });
            const workspaceFolder = vscode.workspace.workspaceFolders?.values().next().value;
            if (!workspaceFolder) {
                throw new Error("No workspace folders found in workspace");
            }
            await workspaceContext?.addPackageFolder(testAssetUri("package2"), workspaceFolder);
            assert.strictEqual(count, 1);
            observer?.dispose();
        }).timeout(15000);
    });

    suite("Tasks", async function () {
        // Was hitting a timeout in suiteSetup during CI build once in a while
        this.timeout(5000);

        const swiftConfig = vscode.workspace.getConfiguration("swift");

        suiteTeardown(async () => {
            await swiftConfig.update("buildArguments", undefined);
            await swiftConfig.update("path", undefined);
            await swiftConfig.update("diagnosticsStyle", undefined);
        });

        test("Default Task values", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            await swiftConfig.update("diagnosticsStyle", undefined);
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "Build All (defaultPackage)");
            assert.strictEqual(execution?.args[0], "build");
            assert.strictEqual(execution?.args[1], "--build-tests");
            assert.strictEqual(execution?.args[2], "-Xswiftc");
            assert.strictEqual(execution?.args[3], "-diagnostic-style=llvm");
            assert.strictEqual(buildAllTask.scope, folder.workspaceFolder);
        });

        test('"default" diagnosticsStyle', async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            await swiftConfig.update("diagnosticsStyle", "default");
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "Build All (defaultPackage)");
            assert.strictEqual(execution?.args[0], "build");
            assert.strictEqual(execution?.args[1], "--build-tests");
            assert.strictEqual(buildAllTask.scope, folder.workspaceFolder);
        });

        test('"swift" diagnosticsStyle', async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            await swiftConfig.update("diagnosticsStyle", "swift");
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "Build All (defaultPackage)");
            assert.strictEqual(execution?.args[0], "build");
            assert.strictEqual(execution?.args[1], "--build-tests");
            assert.strictEqual(execution?.args[2], "-Xswiftc");
            assert.strictEqual(execution?.args[3], "-diagnostic-style=swift");
            assert.strictEqual(buildAllTask.scope, folder.workspaceFolder);
        });

        test("Build Settings", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            await swiftConfig.update("diagnosticsStyle", undefined);
            await swiftConfig.update("buildArguments", ["--sanitize=thread"]);
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution as SwiftExecution;
            assert.strictEqual(execution?.args[0], "build");
            assert.strictEqual(execution?.args[1], "--build-tests");
            assert.strictEqual(execution?.args[2], "-Xswiftc");
            assert.strictEqual(execution?.args[3], "-diagnostic-style=llvm");
            assert.strictEqual(execution?.args[4], "--sanitize=thread");
            await swiftConfig.update("buildArguments", []);
        });

        test("Swift Path", async () => {
            /* Temporarily disabled (need swift path to update immediately for this to work)
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            await swiftConfig.update("path", "/usr/bin/swift");
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution as SwiftExecution;
            assert.strictEqual(execution?.command, "/usr/bin/swift");
            await swiftConfig.update("path", "");*/
        });
    });

    suite("Toolchain", () => {
        test("get project templates", async () => {
            // This is only supported in swift versions >=5.8.0
            const swiftVersion = workspaceContext.toolchain.swiftVersion;
            if (swiftVersion.isLessThan(new Version(5, 8, 0))) {
                assert.deepEqual(await workspaceContext.toolchain.getProjectTemplates(), []);
                return;
            }
            // The output of `swift package init --help` will probably change at some point.
            // Just make sure that the most complex portions of the output are parsed correctly.
            const projectTemplates = await workspaceContext.toolchain.getProjectTemplates();
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
        }).timeout(1000);
    });
}).timeout(10000);
