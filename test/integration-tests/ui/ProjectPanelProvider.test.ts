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
import * as vscode from "vscode";
import * as path from "path";
import { ProjectPanelProvider, PackageNode, FileNode } from "../../../src/ui/ProjectPanelProvider";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities/tasks";
import { getBuildAllTask, SwiftTask } from "../../../src/tasks/SwiftTaskProvider";
import { testAssetPath } from "../../fixtures";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";
import contextKeys from "../../../src/contextKeys";

suite("ProjectPanelProvider Test Suite", function () {
    let treeProvider: ProjectPanelProvider;
    this.timeout(2 * 60 * 1000); // Allow up to 2 minutes to build

    activateExtensionForSuite({
        async setup(ctx) {
            const workspaceContext = ctx;
            await waitForNoRunningTasks();
            await folderInRootWorkspace("defaultPackage", workspaceContext);
            const folderContext = await folderInRootWorkspace("targets", workspaceContext);
            await executeTaskAndWaitForResult((await getBuildAllTask(folderContext)) as SwiftTask);
            await folderContext.loadSwiftPlugins();
            treeProvider = new ProjectPanelProvider(workspaceContext);
            await workspaceContext.focusFolder(folderContext);
        },
        async teardown() {
            contextKeys.flatDependenciesList = false;
            treeProvider.dispose();
        },
        testAssets: ["targets"],
    });

    test("Includes top level nodes", async () => {
        const commands = await treeProvider.getChildren();
        const commandNames = commands.map(n => n.name);
        expect(commandNames).to.deep.equal([
            "Dependencies",
            "Targets",
            "Tasks",
            "Snippets",
            "Commands",
        ]);
    });

    suite("Targets", () => {
        test("Includes targets", async () => {
            const targets = await getHeaderChildren("Targets");
            const targetNames = targets.map(target => target.name);
            expect(
                targetNames,
                `Expected to find dependencies target, but instead items were ${targetNames}`
            ).to.deep.equal(["ExecutableTarget", "LibraryTarget", "PluginTarget", "TargetsTests"]);
        });
    });

    suite("Tasks", () => {
        test("Includes tasks", async () => {
            const tasks = await getHeaderChildren("Tasks");
            const dep = tasks.find(n => n.name === "Build All (targets)") as PackageNode;
            expect(
                dep,
                `Expected to find dependencies target, but instead items were ${tasks.map(n => n.name)}`
            ).to.not.be.undefined;
        });

        test("Executes a task", async () => {
            const tasks = await getHeaderChildren("Tasks");
            const task = tasks.find(n => n.name === "Build All (targets)");
            expect(task).to.not.be.undefined;
            const treeItem = task?.toTreeItem();
            expect(treeItem?.command).to.not.be.undefined;
            expect(treeItem?.command?.arguments).to.not.be.undefined;
            if (treeItem && treeItem.command && treeItem.command.arguments) {
                const command = treeItem.command.command;
                const args = treeItem.command.arguments;
                console.log("Executing", command, args);
                const result = await vscode.commands.executeCommand(command, ...args);
                expect(result).to.be.true;
            }
        });
    });

    suite("Snippets", () => {
        test("Includes snippets", async () => {
            const snippets = await getHeaderChildren("Snippets");
            const snippetNames = snippets.map(n => n.name);
            expect(snippetNames).to.deep.equal(["AnotherSnippet", "Snippet"]);

            for (const snippet of snippets) {
                const snippetTasks = await snippet.getChildren();
                expect(snippetTasks.map(n => n.name)).to.deep.equal(["Run", "Debug"]);
            }
        });

        test("Executes a snippet", async () => {
            const snippets = await getHeaderChildren("Snippets");
            const snippet = snippets.find(n => n.name === "Snippet");
            expect(snippet).to.not.be.undefined;
            const tasks = await snippet?.getChildren();
            const runTask = tasks?.find(n => n.name === "Run");
            expect(runTask).to.not.be.undefined;
            expect(runTask).to.not.be.undefined;
            const treeItem = runTask?.toTreeItem();
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

    suite("Commands", () => {
        test("Includes commands", async () => {
            const commands = await getHeaderChildren("Commands");
            const commandNames = commands.map(n => n.name);
            expect(commandNames).to.deep.equal(["PluginTarget"]);
        });

        test("Executes a command", async () => {
            const commands = await getHeaderChildren("Commands");
            const command = commands.find(n => n.name === "PluginTarget");
            expect(command).to.not.be.undefined;
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
    });

    async function getHeaderChildren(headerName: string) {
        const headers = await treeProvider.getChildren();
        const header = headers.find(n => n.name === headerName) as PackageNode;
        expect(header).to.not.be.undefined;
        return await header.getChildren();
    }

    function assertPathsEqual(path1: string | undefined, path2: string | undefined) {
        expect(path1).to.not.be.undefined;
        expect(path2).to.not.be.undefined;
        // Convert to vscode.Uri to normalize paths, including drive letter capitalization on Windows.
        expect(vscode.Uri.file(path1!).fsPath).to.equal(vscode.Uri.file(path2!).fsPath);
    }
});
