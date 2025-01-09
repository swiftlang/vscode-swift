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
import {
    PackageDependenciesProvider,
    PackageNode,
} from "../../../src/ui/PackageDependencyProvider";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities/tasks";
import { getBuildAllTask, SwiftTask } from "../../../src/tasks/SwiftTaskProvider";
import { testAssetPath } from "../../fixtures";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";

suite("PackageDependencyProvider Test Suite", function () {
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;
    let treeProvider: PackageDependenciesProvider;
    this.timeout(2 * 60 * 1000); // Allow up to 2 minutes to build

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            await waitForNoRunningTasks();
            folderContext = await folderInRootWorkspace("dependencies", workspaceContext);
            await executeTaskAndWaitForResult((await getBuildAllTask(folderContext)) as SwiftTask);
            await folderContext.reload();
            treeProvider = new PackageDependenciesProvider(workspaceContext);
        },
        async teardown() {
            treeProvider.dispose();
        },
    });

    setup(async () => {
        await workspaceContext.focusFolder(folderContext);
    });

    test("Includes remote dependency", async () => {
        const items = await treeProvider.getChildren();

        const dep = items.find(n => n.name === "swift-markdown") as PackageNode;
        expect(dep, `${JSON.stringify(items, null, 2)}`).to.not.be.undefined;
        expect(dep?.location).to.equal("https://github.com/swiftlang/swift-markdown.git");
        assertPathsEqual(
            dep?.path,
            path.join(testAssetPath("dependencies"), ".build/checkouts/swift-markdown")
        );
    });

    test("Includes local dependency", async () => {
        const items = await treeProvider.getChildren();

        const dep = items.find(n => n.name === "defaultpackage") as PackageNode;
        expect(
            dep,
            `Expected to find defaultPackage, but instead items were ${items.map(n => n.name)}`
        ).to.not.be.undefined;
        assertPathsEqual(dep?.location, testAssetPath("defaultPackage"));
        assertPathsEqual(dep?.path, testAssetPath("defaultPackage"));
    });

    test("Lists local dependency file structure", async () => {
        const items = await treeProvider.getChildren();

        const dep = items.find(n => n.name === "defaultpackage") as PackageNode;
        expect(
            dep,
            `Expected to find defaultPackage, but instead items were ${items.map(n => n.name)}`
        ).to.not.be.undefined;

        const folders = await treeProvider.getChildren(dep);
        const folder = folders.find(n => n.name === "Sources");
        expect(folder).to.not.be.undefined;

        assertPathsEqual(folder?.path, path.join(testAssetPath("defaultPackage"), "Sources"));

        const childFolders = await treeProvider.getChildren(folder);
        const childFolder = childFolders.find(n => n.name === "PackageExe");
        expect(childFolder).to.not.be.undefined;

        assertPathsEqual(
            childFolder?.path,
            path.join(testAssetPath("defaultPackage"), "Sources/PackageExe")
        );

        const files = await treeProvider.getChildren(childFolder);
        const file = files.find(n => n.name === "main.swift");
        expect(file).to.not.be.undefined;

        assertPathsEqual(
            file?.path,
            path.join(testAssetPath("defaultPackage"), "Sources/PackageExe/main.swift")
        );
    });

    test("Lists remote dependency file structure", async () => {
        const items = await treeProvider.getChildren();

        const dep = items.find(n => n.name === "swift-markdown") as PackageNode;
        expect(dep, `${JSON.stringify(items, null, 2)}`).to.not.be.undefined;

        const folders = await treeProvider.getChildren(dep);
        const folder = folders.find(n => n.name === "Sources");
        expect(folder).to.not.be.undefined;

        const depPath = path.join(testAssetPath("dependencies"), ".build/checkouts/swift-markdown");
        assertPathsEqual(folder?.path, path.join(depPath, "Sources"));

        const childFolders = await treeProvider.getChildren(folder);
        const childFolder = childFolders.find(n => n.name === "CAtomic");
        expect(childFolder).to.not.be.undefined;

        assertPathsEqual(childFolder?.path, path.join(depPath, "Sources/CAtomic"));

        const files = await treeProvider.getChildren(childFolder);
        const file = files.find(n => n.name === "CAtomic.c");
        expect(file).to.not.be.undefined;

        assertPathsEqual(file?.path, path.join(depPath, "Sources/CAtomic/CAtomic.c"));
    });

    function assertPathsEqual(path1: string | undefined, path2: string | undefined) {
        expect(path1).to.not.be.undefined;
        expect(path2).to.not.be.undefined;
        // Convert to vscode.Uri to normalize paths, including drive letter capitalization on Windows.
        expect(vscode.Uri.file(path1!).fsPath).to.equal(vscode.Uri.file(path2!).fsPath);
    }
});
