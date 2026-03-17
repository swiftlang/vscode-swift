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
import { afterEach, beforeEach } from "mocha";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { Commands } from "@src/commands";
import { PlaygroundProvider } from "@src/playgrounds/PlaygroundProvider";
import { Playground } from "@src/sourcekit-lsp/extensions";
import { createBuildAllTask } from "@src/tasks/SwiftTaskProvider";
import {
    FileNode,
    PackageNode,
    ProjectPanelProvider,
    TreeNode,
} from "@src/ui/ProjectPanelProvider";
import { wait } from "@src/utilities/utilities";
import { Version } from "@src/utilities/version";

import { testAssetPath } from "../../fixtures";
import { tag } from "../../tags";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities/tasks";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "../utilities/testutilities";

tag("medium").suite("ProjectPanelProvider Test Suite", function () {
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;
    let treeProvider: ProjectPanelProvider;

    class MockPlaygroundProvider extends PlaygroundProvider {
        setPlaygrounds(playgrounds: Playground[]) {
            this.setWorkspacePlaygrounds(playgrounds);
            this.didChangePlaygroundsEmitter.fire({
                uri: playgrounds[0]?.location.uri ?? "",
                playgrounds,
            });
        }
    }

    function makePlayground(id: string, uri: string, label?: string): Playground {
        return {
            id,
            ...(label ? { label } : {}),
            location: {
                uri,
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                },
            },
        };
    }

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;

            folderContext = await folderInRootWorkspace("targets", workspaceContext);
            await vscode.workspace.openTextDocument(
                path.join(folderContext.folder.fsPath, "Package.swift")
            );
            const logger = await ctx.loggerFactory.temp("ProjectPanelProvider.tests");
            await folderContext.loadSwiftPlugins(logger);
            if (logger.logs.length > 0) {
                expect.fail(
                    `Expected no output channel logs: ${JSON.stringify(logger.logs, undefined, 2)}`
                );
            }

            treeProvider = ctx.projectPanel;

            await workspaceContext.focusFolder(folderContext);
            const buildAllTask = await createBuildAllTask(folderContext);
            buildAllTask.definition.dontTriggerTestDiscovery = true;
            await executeTaskAndWaitForResult(buildAllTask);
        },
        async teardown() {
            workspaceContext.contextKeys.flatDependenciesList = false;
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
                // There is a bug in 5.9 where if you have a build tool plugin and a
                // command plugin the command plugins do not get returned from `swift package plugin list`.
                if (
                    workspaceContext.globalToolchain.swiftVersion.isLessThan(new Version(5, 10, 0))
                ) {
                    expect(commandNames).to.deep.equal([
                        "Dependencies",
                        "Targets",
                        "Tasks",
                        "Snippets",
                    ]);
                } else {
                    expect(commandNames).to.deep.equal([
                        "Dependencies",
                        "Targets",
                        "Tasks",
                        "Snippets",
                        "Commands",
                    ]);
                }
            }
        );
    });

    suite("Playgrounds", () => {
        let mockPlaygroundProvider: MockPlaygroundProvider | undefined;
        let existingPlaygroundProvider: FolderContext["playgroundProvider"];

        beforeEach(() => {
            existingPlaygroundProvider = folderContext.playgroundProvider;
            mockPlaygroundProvider = new MockPlaygroundProvider(folderContext);
            folderContext.playgroundProvider = mockPlaygroundProvider;
            treeProvider.observeFolder(folderContext);
        });

        afterEach(() => {
            mockPlaygroundProvider?.dispose();
            mockPlaygroundProvider = undefined;
            folderContext.playgroundProvider = existingPlaygroundProvider;
            treeProvider.observeFolder(folderContext);
        });

        test("Includes playgrounds", async () => {
            const playgroundFile = vscode.Uri.file(
                path.join(folderContext.folder.fsPath, "Sources/ExecutableTarget/main.swift")
            ).toString();
            mockPlaygroundProvider?.setPlaygrounds([
                makePlayground("ExecutableTarget/main.swift:4", playgroundFile, "named playground"),
                makePlayground("ExecutableTarget/main.swift:9", playgroundFile),
            ]);

            await waitForChildren(
                () => getHeaderChildren("Playgrounds"),
                playgrounds => {
                    expect(playgrounds.map(playground => playground.name)).to.deep.equal([
                        "named playground",
                        "ExecutableTarget/main.swift:9",
                    ]);
                    const treeItem = playgrounds[0].toTreeItem();
                    expect(treeItem.contextValue).to.equal("playground");
                    expect(treeItem.command?.command).to.equal("vscode.openWith");
                    return playgrounds;
                }
            );
        });

        test("Hides playgrounds when no playgrounds are returned", async () => {
            const playgroundFile = vscode.Uri.file(
                path.join(folderContext.folder.fsPath, "Sources/ExecutableTarget/main.swift")
            ).toString();
            mockPlaygroundProvider?.setPlaygrounds([
                makePlayground("ExecutableTarget/main.swift:4", playgroundFile, "named playground"),
            ]);

            await waitForChildren(
                () => treeProvider.getChildren(),
                headers => {
                    expect(headers.find(header => header.name === "Playgrounds")).to.not.be
                        .undefined;
                    return headers;
                }
            );

            mockPlaygroundProvider?.setPlaygrounds([]);
            await waitForChildren(
                () => treeProvider.getChildren(),
                headers => {
                    expect(headers.find(header => header.name === "Playgrounds")).to.be.undefined;
                    return headers;
                }
            );
        });

        test("Hooks up playground command", async () => {
            const playgroundFile = vscode.Uri.file(
                path.join(folderContext.folder.fsPath, "Sources/ExecutableTarget/main.swift")
            ).toString();
            mockPlaygroundProvider?.setPlaygrounds([
                makePlayground("ExecutableTarget/main.swift:4", playgroundFile, "named playground"),
            ]);

            await waitForChildren(
                () => getHeaderChildren("Playgrounds"),
                playgrounds => {
                    const node = playgrounds[0];
                    const item = node.toTreeItem();
                    expect(item.command?.title).to.equal("Open Playground");
                    expect(item.command?.command).to.equal("vscode.openWith");
                    expect(item.command?.arguments?.[0]).to.deep.equal(
                        vscode.Uri.parse(playgroundFile)
                    );
                    expect(item.command?.arguments?.[1]).to.equal("default");
                    expect(item.command?.arguments?.[2]).to.deep.equal({
                        selection: {
                            start: { line: 0, character: 0 },
                            end: { line: 0, character: 0 },
                        },
                    });
                    return playgrounds;
                }
            );
        });
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
                        "BuildToolExecutableTarget",
                        "ExecutableTarget",
                        "LibraryTarget",
                        "BuildToolPlugin",
                        "PluginTarget",
                        "AnotherTests",
                        "TargetsTests",
                    ]);
                }
            );
        });

        test("Shows files generated by build tool plugin", async function () {
            if (process.platform === "win32") {
                this.skip();
            }

            const children = await getHeaderChildren("Targets");
            const target = children.find(n => n.name === "LibraryTarget") as PackageNode;
            expect(
                target,
                `Expected to find LibraryTarget, but instead items were ${children.map(n => n.name)}`
            ).to.not.be.undefined;
            const generatedFilesHeaders = await target.getChildren();
            const generatedFiles = generatedFilesHeaders.find(
                n => n.name === "BuildToolPlugin - Generated Files"
            ) as PackageNode;
            const generatedFilesChildren = await generatedFiles.getChildren();
            const file = generatedFilesChildren.find(n => n.name === "Foo.swift") as FileNode;
            expect(
                file,
                `Expected to find Foo.swift, but instead items were ${generatedFilesChildren.map(n => n.name)}`
            ).to.not.be.undefined;
            const folder = generatedFilesChildren.find(n => n.name === "Bar") as FileNode;
            const folderChildren = await folder.getChildren();
            const folderFile = folderChildren.find(n => n.name === "Baz.swift") as FileNode;
            expect(
                folderFile,
                `Expected to find Foo.swift, but instead items were ${folderChildren.map(n => n.name)}`
            ).to.not.be.undefined;
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

        test("Executes a task", async function () {
            if (
                process.platform === "win32" &&
                workspaceContext.globalToolchain.swiftVersion.isLessThan(new Version(5, 10, 0))
            ) {
                this.skip();
            }
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
                    new Version(5, 10, 0)
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
                (process.platform === "win32" &&
                    workspaceContext.globalToolchain.swiftVersion.isLessThanOrEqual(
                        new Version(6, 0, 0)
                    )) ||
                workspaceContext.globalToolchain.swiftVersion.isLessThan(new Version(5, 10, 0))
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
                (process.platform === "win32" &&
                    workspaceContext.globalToolchain.swiftVersion.isLessThanOrEqual(
                        new Version(6, 0, 0)
                    )) ||
                workspaceContext.globalToolchain.swiftVersion.isLessThan(new Version(5, 10, 0))
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
            workspaceContext.contextKeys.flatDependenciesList = false;
            const items = await getHeaderChildren("Dependencies");
            const dep = items.find(n => n.name === "swift-markdown") as PackageNode;
            expect(dep, `${JSON.stringify(items, null, 2)}`).to.not.be.undefined;
            expect(dep?.location).to.equal("https://github.com/swiftlang/swift-markdown.git");
            expect(dep?.path).to.equalPath(
                testAssetPath("targets/.build/checkouts/swift-markdown")
            );
        });

        test("Includes local dependency", async () => {
            const items = await getHeaderChildren("Dependencies");
            const dep = items.find(n => n.name === "defaultpackage") as PackageNode;
            expect(
                dep,
                `Expected to find defaultPackage, but instead items were ${items.map(n => n.name)}`
            ).to.not.be.undefined;
            expect(dep?.location).to.equalPath(testAssetPath("defaultPackage"));
            expect(dep?.path).to.equalPath(testAssetPath("defaultPackage"));
        });

        test("Lists local dependency file structure", async () => {
            workspaceContext.contextKeys.flatDependenciesList = false;
            const children = await getHeaderChildren("Dependencies");
            const dep = children.find(n => n.name === "defaultpackage") as PackageNode;
            expect(
                dep,
                `Expected to find defaultPackage, but instead items were ${children.map(n => n.name)}`
            ).to.not.be.undefined;

            const folders = await treeProvider.getChildren(dep);
            const folder = folders.find(n => n.name === "Sources") as FileNode;
            expect(folder).to.not.be.undefined;

            expect(folder?.path).to.equalPath(testAssetPath("defaultPackage/Sources"));

            const childFolders = await treeProvider.getChildren(folder);
            const childFolder = childFolders.find(n => n.name === "PackageExe") as FileNode;
            expect(childFolder).to.not.be.undefined;

            expect(childFolder?.path).to.equalPath(
                testAssetPath("defaultPackage/Sources/PackageExe")
            );

            const files = await treeProvider.getChildren(childFolder);
            const file = files.find(n => n.name === "main.swift") as FileNode;
            expect(file).to.not.be.undefined;

            expect(file?.path).to.equalPath(
                testAssetPath("defaultPackage/Sources/PackageExe/main.swift")
            );
        });

        test("Lists remote dependency file structure", async () => {
            workspaceContext.contextKeys.flatDependenciesList = false;
            const children = await getHeaderChildren("Dependencies");
            const dep = children.find(n => n.name === "swift-markdown") as PackageNode;
            expect(dep, `${JSON.stringify(children, null, 2)}`).to.not.be.undefined;

            const folders = await treeProvider.getChildren(dep);
            const folder = folders.find(n => n.name === "Sources") as FileNode;
            expect(folder).to.not.be.undefined;

            const depPath = path.join(testAssetPath("targets"), ".build/checkouts/swift-markdown");
            expect(folder?.path).to.equalPath(path.join(depPath, "Sources"));

            const childFolders = await treeProvider.getChildren(folder);
            const childFolder = childFolders.find(n => n.name === "CAtomic") as FileNode;
            expect(childFolder).to.not.be.undefined;

            expect(childFolder?.path).to.equalPath(path.join(depPath, "Sources/CAtomic"));

            const files = await treeProvider.getChildren(childFolder);
            const file = files.find(n => n.name === "CAtomic.c") as FileNode;
            expect(file).to.not.be.undefined;

            expect(file?.path).to.equalPath(path.join(depPath, "Sources/CAtomic/CAtomic.c"));
        });

        test("Shows a flat dependency list", async () => {
            workspaceContext.contextKeys.flatDependenciesList = true;
            const items = await getHeaderChildren("Dependencies");
            expect(items.length).to.equal(3);
            expect(items.find(n => n.name === "swift-markdown")).to.not.be.undefined;
            expect(items.find(n => n.name === "swift-cmark")).to.not.be.undefined;
            expect(items.find(n => n.name === "defaultpackage")).to.not.be.undefined;
        });

        test("Shows a nested dependency list", async () => {
            workspaceContext.contextKeys.flatDependenciesList = false;
            const items = await getHeaderChildren("Dependencies");
            expect(items.length).to.equal(2);
            expect(items.find(n => n.name === "swift-markdown")).to.not.be.undefined;
            expect(items.find(n => n.name === "defaultpackage")).to.not.be.undefined;
        });

        suite("Error handling", () => {
            let savedCurrentFolder: FolderContext | null | undefined;
            let errorTreeProvider: ProjectPanelProvider | undefined;

            beforeEach(async () => {
                workspaceContext.folders[0].hasResolveErrors = true;
                savedCurrentFolder = workspaceContext.currentFolder;
                workspaceContext.currentFolder = workspaceContext.folders[0];
            });

            afterEach(() => {
                errorTreeProvider?.dispose();
                errorTreeProvider = undefined;
                workspaceContext.folders[0].hasResolveErrors = false;
                workspaceContext.currentFolder = savedCurrentFolder;
            });

            test("Shows an error node when there is a problem compiling Package.swift", async () => {
                workspaceContext.folders[0].hasResolveErrors = true;
                workspaceContext.currentFolder = workspaceContext.folders[0];
                errorTreeProvider = new ProjectPanelProvider(workspaceContext);
                const children = await errorTreeProvider.getChildren();
                const errorNode = children.find(n => n.name === "Error Parsing Package.swift");
                expect(errorNode).to.not.be.undefined;
            });
        });

        suite("Excluded files", () => {
            let resetSettings: (() => Promise<void>) | undefined;
            beforeEach(async function () {
                resetSettings = await updateSettings({
                    "files.exclude": { "**/*.swift": true, "**/*.txt": false },
                    "swift.excludePathsFromPackageDependencies": ["**/*.md"],
                });
            });

            test("Excludes files based on settings", async () => {
                workspaceContext.contextKeys.flatDependenciesList = false;
                const children = await getHeaderChildren("Dependencies");
                const dep = children.find(n => n.name === "swift-markdown") as PackageNode;
                expect(dep, `${JSON.stringify(children, null, 2)}`).to.not.be.undefined;

                const folders = await treeProvider.getChildren(dep);
                const manifest = folders.find(n => n.name === "Package.swift") as FileNode;
                expect(manifest, "Package.swift was not found").to.be.undefined;
                const readme = folders.find(n => n.name === "README.md") as FileNode;
                expect(readme, "README.md was not found").to.be.undefined;
                const licence = folders.find(n => n.name === "LICENSE.txt") as FileNode;
                expect(licence, "LICENSE.txt was not found").to.not.be.undefined;
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
});
