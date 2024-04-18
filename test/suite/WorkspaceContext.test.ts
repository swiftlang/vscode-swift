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
import { testAssetUri } from "../fixtures";
import { FolderEvent, WorkspaceContext } from "../../src/WorkspaceContext";
import { createBuildAllTask, platformDebugBuildOptions } from "../../src/SwiftTaskProvider";
import { globalWorkspaceContextPromise } from "./extension.test";

suite("WorkspaceContext Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    const packageFolder: vscode.Uri = testAssetUri("defaultPackage");

    suiteSetup(async () => {
        workspaceContext = await globalWorkspaceContextPromise;
    });

    suite("Folder Events", () => {
        test("Add", async () => {
            let count = 0;
            const observer = workspaceContext?.observeFolders((folder, operation) => {
                assert(folder !== null);
                assert.strictEqual(folder.swiftPackage.name, "package2");
                switch (operation) {
                    case FolderEvent.add:
                        count++;
                        break;
                }
            });
            const workspaceFolder = vscode.workspace.workspaceFolders?.values().next().value;
            await workspaceContext?.addPackageFolder(testAssetUri("package2"), workspaceFolder);
            assert.strictEqual(count, 1);
            observer?.dispose();
        }).timeout(5000);
    });

    suite("Tasks", async () => {
        const swiftConfig = vscode.workspace.getConfiguration("swift");

        suiteTeardown(async () => {
            await swiftConfig.update("buildArguments", undefined);
            await swiftConfig.update("path", undefined);
        });

        test("Default Task values", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution as vscode.ProcessExecution;
            assert.strictEqual(buildAllTask.definition.type, "swift");
            assert.strictEqual(buildAllTask.name, "Build All (defaultPackage)");
            assert.notStrictEqual(execution?.args, [
                "build",
                "--build-tests",
                ...platformDebugBuildOptions(workspaceContext.toolchain),
            ]);
            assert.strictEqual(buildAllTask.scope, folder.workspaceFolder);
        });

        test("Build Settings", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            await swiftConfig.update("buildArguments", ["--sanitize=thread"]);
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution as vscode.ShellExecution;
            assert.notStrictEqual(execution?.args, [
                "build",
                "--build-tests",
                ...platformDebugBuildOptions(workspaceContext.toolchain),
                "--sanitize=thread",
            ]);
            await swiftConfig.update("buildArguments", []);
        });

        test("Swift Path", async () => {
            const folder = workspaceContext.folders.find(
                f => f.folder.fsPath === packageFolder.fsPath
            );
            assert(folder);
            await swiftConfig.update("path", "/usr/bin/swift");
            const buildAllTask = createBuildAllTask(folder);
            const execution = buildAllTask.execution as vscode.ShellExecution;
            assert.notStrictEqual(execution?.command, "/usr/bin/swift");
            await swiftConfig.update("path", "");
        });
    });

    suite("Toolchain", () => {
        test("get project templates", async () => {
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
