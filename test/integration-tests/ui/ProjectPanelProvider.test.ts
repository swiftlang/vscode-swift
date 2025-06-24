//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import { expect } from "chai";
import { beforeEach, afterEach } from "mocha";
import * as vscode from "vscode";
import * as path from "path";
import {
    ProjectPanelProvider,
    PackageNode,
    FileNode,
    TreeNode,
} from "../../../src/ui/ProjectPanelProvider";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities/tasks";
import { createBuildAllTask } from "../../../src/tasks/SwiftTaskProvider";
import { testAssetPath } from "../../fixtures";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "../utilities/testutilities";
import contextKeys from "../../../src/contextKeys";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Version } from "../../../src/utilities/version";
import { wait } from "../../../src/utilities/utilities";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";
import { Commands } from "../../../src/commands";

suite("ProjectPanelProvider Test Suite", function () {
    let workspaceContext: WorkspaceContext;
    let treeProvider: ProjectPanelProvider;
    this.timeout(5 * 60 * 1000); // Allow up to 5 minutes to build

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            const folderContext = await folderInRootWorkspace("targets", workspaceContext);
            await vscode.workspace.openTextDocument(
                path.join(folderContext.folder.fsPath, "Package.swift")
            );
            const outputChannel = new SwiftOutputChannel("ProjectPanelProvider.tests");
            await folderContext.loadSwiftPlugins(outputChannel);
            expect(outputChannel.logs.length).to.equal(0, `Expected no output channel logs`);
            treeProvider = new ProjectPanelProvider(workspaceContext);
            await workspaceContext.focusFolder(folderContext);
            const buildAllTask = await createBuildAllTask(folderContext);
            buildAllTask.definition.dontTriggerTestDiscovery = true;
            await executeTaskAndWaitForResult(buildAllTask);
        },
        async teardown() {
            contextKeys.flatDependenciesList = false;
            treeProvider.dispose();
        },
        testAssets: ["targets"],
    });

    let resetSettings: (() => Promise<void>) | undefined;
    beforeEach(async function () {
        resetSettings = await updateSettings({
            "swift.debugger.debugAdapter": "CodeLLDB",
        });
    });

    afterEach(async () => {
        if (resetSettings) {
            await resetSettings();
            resetSettings = undefined;
        }
    });

    test("Includes top level nodes", async () => {
        await waitForChildren(
            () => treeProvider.getChildren(),
            commands => {
                const commandNames = commands.map(n => n.name);
                expect(commandNames).to.deep.equal([
                    "Dependencies",
                    "Targets",
                    "Tasks",
                    "Snippets",
                    "Commands",
                ]);
            }
        );
    });

    suite("Targets", () => {
        test("Includes targets", async () => {
            await waitForChildren(
                () => getHeaderChildren("Targets"),
                targets => {
                    const targetNames = targets.map(target => target.name);
                    expect(
                        targetNames,
                        `Expected to find dependencies target, but instead items were ${targetNames}`
                    ).to.deep.equal([
                        "ExecutableTarget",
                        "LibraryTarget",
                        "PluginTarget",
                        "AnotherTests",
                        "TargetsTests",
                    ]);
                }
            );
        });
    });

    suite("Tasks", () => {
        beforeEach(async () => {
            await waitForNoRunningTasks();
        });

        async function getBuildAllTask() {
            // In Swift 5.10 and below the build tasks are disabled while other tasks that could modify .build are running.
            // Typically because the extension has just started up in tests its `swift test list` that runs to gather tests
            // for the test explorer. If we're running 5.10 or below, poll for the build all task for up to 60 seconds.
            if (workspaceContext.globalToolchain.swiftVersion.isLessThan(new Version(6, 0, 0))) {
                const startTime = Date.now();
                let task: PackageNode | undefined;
                while (!task && Date.now() - startTime < 45 * 1000) {
                    const tasks = await getHeaderChildren("Tasks");
                    task = tasks.find(n => n.name === "Build All (targets)") as PackageNode;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                return task;
            } else {
                const tasks = await getHeaderChildren("Tasks");
                return tasks.find(n => n.name === "Build All (targets)") as PackageNode;
            }
        }

        test("Includes tasks", async () => {
            const dep = await getBuildAllTask();
            expect(dep).to.not.be.undefined;
        });

        test("Executes a task", async () => {
            const task = await getBuildAllTask();
            expect(task).to.not.be.undefined;
            const treeItem = task?.toTreeItem();
            expect(treeItem?.command).to.not.be.undefined;
            expect(treeItem?.command?.arguments).to.not.be.undefined;
            if (treeItem && treeItem.command && treeItem.command.arguments) {
                const command = treeItem.command.command;
                const args = treeItem.command.arguments;
                const result = await vscode.commands.executeCommand(command, ...args);
                expect(result).to.be.true;
            }
        });
    });

    suite("Snippets", () => {
        test("Includes snippets", async () => {
            await waitForChildren(
                () => getHeaderChildren("Snippets"),
                snippets => {
                    const snippetNames = snippets.map(n => n.name);
                    expect(snippetNames).to.deep.equal(["AnotherSnippet", "Snippet"]);
                }
            );
        });

        test("Executes a snippet", async function () {
            if (
                process.platform === "win32" &&
                workspaceContext.globalToolchain.swiftVersion.isLessThanOrEqual(
                    new Version(5, 9, 0)
                )
            ) {
                this.skip();
            }

            const snippet = await waitForChildren(
                () => getHeaderChildren("Snippets"),
                snippets => {
                    const snippet = snippets.find(n => n.name === "Snippet");
                    expect(snippet).to.not.be.undefined;
                    return snippet;
                }
            );
            const result = await vscode.commands.executeCommand(
                Commands.RUN_SNIPPET,
                snippet?.name
            );
            expect(result).to.be.true;
        });
    });

    suite("Commands", () => {
        test("Includes commands", async function () {
            if (
                process.platform === "win32" &&
                workspaceContext.globalToolchain.swiftVersion.isLessThanOrEqual(
                    new Version(6, 0, 0)
                )
            ) {
                this.skip();
            }

            await waitForChildren(
                () => getHeaderChildren("Commands"),
                commands => {
                    const commandNames = commands.map(n => n.name);
                    expect(commandNames).to.deep.equal(["PluginTarget"]);
                }
            );
        });

        test("Executes a command", async function () {
            if (
                process.platform === "win32" &&
                workspaceContext.globalToolchain.swiftVersion.isLessThanOrEqual(
                    new Version(6, 0, 0)
                )
            ) {
                this.skip();
            }

            const command = await waitForChildren(
                () => getHeaderChildren("Commands"),
                commands => {
                    const command = commands.find(n => n.name === "PluginTarget");
                    expect(command).to.not.be.undefined;
                    return command;
                }
            );
            const treeItem = command?.toTreeItem();
            expect(treeItem?.command).to.not.be.undefined;
            expect(treeItem?.command?.arguments).to.not.be.undefined;
            if (treeItem && treeItem.command && treeItem.command.arguments) {
                const command = treeItem.command.command;
                const args = treeItem.command.arguments;
                const result = await vscode.commands.executeCommand(command, ...args);
                expect(result).to.be.true;
            }
        });
    });

    suite("Dependencies", () => {
        test("Includes remote dependency", async () => {
            contextKeys.flatDependenciesList = false;
            const items = await getHeaderChildren("Dependencies");
            const dep = items.find(n => n.name === "swift-markdown") as PackageNode;
            expect(dep, `${JSON.stringify(items, null, 2)}`).to.not.be.undefined;
            expect(dep?.location).to.equal("https://github.com/swiftlang/swift-markdown.git");
            assertPathsEqual(
                dep?.path,
                path.join(testAssetPath("targets"), ".build/checkouts/swift-markdown")
            );
        });

        test("Includes local dependency", async () => {
            const items = await getHeaderChildren("Dependencies");
            const dep = items.find(n => n.name === "defaultpackage") as PackageNode;
            expect(
                dep,
                `Expected to find defaultPackage, but instead items were ${items.map(n => n.name)}`
            ).to.not.be.undefined;
            assertPathsEqual(dep?.location, testAssetPath("defaultPackage"));
            assertPathsEqual(dep?.path, testAssetPath("defaultPackage"));
        });

        test("Lists local dependency file structure", async () => {
            contextKeys.flatDependenciesList = false;
            const children = await getHeaderChildren("Dependencies");
            const dep = children.find(n => n.name === "defaultpackage") as PackageNode;
            expect(
                dep,
                `Expected to find defaultPackage, but instead items were ${children.map(n => n.name)}`
            ).to.not.be.undefined;

            const folders = await treeProvider.getChildren(dep);
            const folder = folders.find(n => n.name === "Sources") as FileNode;
            expect(folder).to.not.be.undefined;

            assertPathsEqual(folder?.path, path.join(testAssetPath("defaultPackage"), "Sources"));

            const childFolders = await treeProvider.getChildren(folder);
            const childFolder = childFolders.find(n => n.name === "PackageExe") as FileNode;
            expect(childFolder).to.not.be.undefined;

            assertPathsEqual(
                childFolder?.path,
                path.join(testAssetPath("defaultPackage"), "Sources/PackageExe")
            );

            const files = await treeProvider.getChildren(childFolder);
            const file = files.find(n => n.name === "main.swift") as FileNode;
            expect(file).to.not.be.undefined;

            assertPathsEqual(
                file?.path,
                path.join(testAssetPath("defaultPackage"), "Sources/PackageExe/main.swift")
            );
        });

        test("Lists remote dependency file structure", async () => {
            contextKeys.flatDependenciesList = false;
            const children = await getHeaderChildren("Dependencies");
            const dep = children.find(n => n.name === "swift-markdown") as PackageNode;
            expect(dep, `${JSON.stringify(children, null, 2)}`).to.not.be.undefined;

            const folders = await treeProvider.getChildren(dep);
            const folder = folders.find(n => n.name === "Sources") as FileNode;
            expect(folder).to.not.be.undefined;

            const depPath = path.join(testAssetPath("targets"), ".build/checkouts/swift-markdown");
            assertPathsEqual(folder?.path, path.join(depPath, "Sources"));

            const childFolders = await treeProvider.getChildren(folder);
            const childFolder = childFolders.find(n => n.name === "CAtomic") as FileNode;
            expect(childFolder).to.not.be.undefined;

            assertPathsEqual(childFolder?.path, path.join(depPath, "Sources/CAtomic"));

            const files = await treeProvider.getChildren(childFolder);
            const file = files.find(n => n.name === "CAtomic.c") as FileNode;
            expect(file).to.not.be.undefined;

            assertPathsEqual(file?.path, path.join(depPath, "Sources/CAtomic/CAtomic.c"));
        });

        test("Shows a flat dependency list", async () => {
            contextKeys.flatDependenciesList = true;
            const items = await getHeaderChildren("Dependencies");
            expect(items.length).to.equal(3);
            expect(items.find(n => n.name === "swift-markdown")).to.not.be.undefined;
            expect(items.find(n => n.name === "swift-cmark")).to.not.be.undefined;
            expect(items.find(n => n.name === "defaultpackage")).to.not.be.undefined;
        });

        test("Shows a nested dependency list", async () => {
            contextKeys.flatDependenciesList = false;
            const items = await getHeaderChildren("Dependencies");
            expect(items.length).to.equal(2);
            expect(items.find(n => n.name === "swift-markdown")).to.not.be.undefined;
            expect(items.find(n => n.name === "defaultpackage")).to.not.be.undefined;
        });

        test("Shows an error node when there is a problem compiling Package.swift", async () => {
            workspaceContext.folders[0].hasResolveErrors = true;
            workspaceContext.currentFolder = workspaceContext.folders[0];
            const treeProvider = new ProjectPanelProvider(workspaceContext);
            const children = await treeProvider.getChildren();
            const errorNode = children.find(n => n.name === "Error Parsing Package.swift");
            expect(errorNode).to.not.be.undefined;
        });

        suite("Excluded files", () => {
            let resetSettings: (() => Promise<void>) | undefined;
            beforeEach(async function () {
                resetSettings = await updateSettings({
                    "files.exclude": { "**/*.swift": true },
                    "swift.excludePathsFromPackageDependencies": ["**/*.md"],
                });
            });

            test("Excludes files based on settings", async () => {
                contextKeys.flatDependenciesList = false;
                const children = await getHeaderChildren("Dependencies");
                const dep = children.find(n => n.name === "swift-markdown") as PackageNode;
                expect(dep, `${JSON.stringify(children, null, 2)}`).to.not.be.undefined;

                const folders = await treeProvider.getChildren(dep);
                const manifest = folders.find(n => n.name === "Package.swift") as FileNode;
                expect(manifest).to.be.undefined;
                const readme = folders.find(n => n.name === "README.md") as FileNode;
                expect(readme).to.be.undefined;
                const licence = folders.find(n => n.name === "LICENSE.txt") as FileNode;
                expect(licence).to.not.be.undefined;
            });

            afterEach(async () => {
                if (resetSettings) {
                    await resetSettings();
                    resetSettings = undefined;
                }
            });
        });
    });

    async function getHeaderChildren(headerName: string) {
        const headers = await treeProvider.getChildren();
        const header = headers.find(n => n.name === headerName) as PackageNode;
        expect(header).to.not.be.undefined;
        return await header.getChildren();
    }

    async function waitForChildren<T>(
        getChildren: () => Promise<TreeNode[]>,
        predicate: (children: TreeNode[]) => T
    ) {
        let counter = 0;
        let error: unknown;
        // Check the predicate once a second for 30 seconds.
        while (counter < 30) {
            const children = await getChildren();
            try {
                return predicate(children);
            } catch (err) {
                error = err;
                counter += 1;
            }

            if (!error) {
                break;
            }

            await wait(1000);
        }

        if (error) {
            throw error;
        }
    }

    function assertPathsEqual(path1: string | undefined, path2: string | undefined) {
        expect(path1).to.not.be.undefined;
        expect(path2).to.not.be.undefined;
        // Convert to vscode.Uri to normalize paths, including drive letter capitalization on Windows.
        expect(vscode.Uri.file(path1!).fsPath).to.equal(vscode.Uri.file(path2!).fsPath);
    }
});
