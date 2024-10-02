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
import {
    PackageDependenciesProvider,
    PackageNode,
} from "../../../src/ui/PackageDependencyProvider";
import { folderContextPromise, globalWorkspaceContextPromise } from "../extension.test";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities";
import { getBuildAllTask, SwiftTask } from "../../../src/tasks/SwiftTaskProvider";
import { testAssetPath } from "../../fixtures";

suite("PackageDependencyProvider Test Suite", function () {
    let treeProvider: PackageDependenciesProvider;
    suiteSetup(async function () {
        this.timeout(2 * 60 * 1000); // Allow up to 2 minutes to build
        const workspaceContext = await globalWorkspaceContextPromise;
        await waitForNoRunningTasks();
        const folderContext = await folderContextPromise("dependencies");
        await executeTaskAndWaitForResult((await getBuildAllTask(folderContext)) as SwiftTask);
        await workspaceContext.focusFolder(folderContext);
        treeProvider = new PackageDependenciesProvider(workspaceContext);
    });

    suiteTeardown(() => {
        treeProvider.dispose();
    });

    test("Includes remote dependency", async () => {
        const items = await treeProvider.getChildren();

        const dep = items.find(n => n.name === "swift-markdown") as PackageNode;
        expect(dep).to.not.be.undefined;
        expect(dep?.location).to.equal("https://github.com/swiftlang/swift-markdown.git");
        expect(dep?.path).to.equal(
            `${testAssetPath("dependencies")}/.build/checkouts/swift-markdown`
        );
    });

    test("Includes local dependency", async () => {
        const items = await treeProvider.getChildren();

        const dep = items.find(n => n.name === "defaultpackage") as PackageNode;
        expect(dep).to.not.be.undefined;
        expect(dep?.location).to.equal(testAssetPath("defaultPackage"));
        expect(dep?.path).to.equal(testAssetPath("defaultPackage"));
    });

    test("Lists local dependency file structure", async () => {
        const items = await treeProvider.getChildren();

        const dep = items.find(n => n.name === "defaultpackage") as PackageNode;
        expect(dep).to.not.be.undefined;

        const folders = await treeProvider.getChildren(dep);
        const folder = folders.find(n => n.name === "Sources");
        expect(folder).to.not.be.undefined;

        expect(folder?.path).to.equal(`${testAssetPath("defaultPackage")}/Sources`);

        const childFolders = await treeProvider.getChildren(folder);
        const childFolder = childFolders.find(n => n.name === "PackageExe");
        expect(childFolder).to.not.be.undefined;

        expect(childFolder?.path).to.equal(`${testAssetPath("defaultPackage")}/Sources/PackageExe`);

        const files = await treeProvider.getChildren(childFolder);
        const file = files.find(n => n.name === "main.swift");
        expect(file).to.not.be.undefined;

        expect(file?.path).to.equal(
            `${testAssetPath("defaultPackage")}/Sources/PackageExe/main.swift`
        );
    });

    test("Lists remote dependency file structure", async () => {
        const items = await treeProvider.getChildren();

        const dep = items.find(n => n.name === "swift-markdown") as PackageNode;
        expect(dep).to.not.be.undefined;

        const folders = await treeProvider.getChildren(dep);
        const folder = folders.find(n => n.name === "Sources");
        expect(folder).to.not.be.undefined;

        const path = `${testAssetPath("dependencies")}/.build/checkouts/swift-markdown`;
        expect(folder?.path).to.equal(`${path}/Sources`);

        const childFolders = await treeProvider.getChildren(folder);
        const childFolder = childFolders.find(n => n.name === "CAtomic");
        expect(childFolder).to.not.be.undefined;

        expect(childFolder?.path).to.equal(`${path}/Sources/CAtomic`);

        const files = await treeProvider.getChildren(childFolder);
        const file = files.find(n => n.name === "CAtomic.c");
        expect(file).to.not.be.undefined;

        expect(file?.path).to.equal(`${path}/Sources/CAtomic/CAtomic.c`);
    });
});
