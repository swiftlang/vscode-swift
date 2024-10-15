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
import {
    PackageDependenciesProvider,
    PackageNode,
} from "../../../src/ui/PackageDependencyProvider";
import { folderContextPromise, globalWorkspaceContextPromise } from "../extension.test";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities";
import { getBuildAllTask, SwiftTask } from "../../../src/tasks/SwiftTaskProvider";
import { testAssetPath, testAssetUri } from "../../fixtures";
import { Version } from "../../../src/utilities/version";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { resolveDependencies } from "../../../src/commands/dependencies/resolve";
import { updateDependencies } from "../../../src/commands/dependencies/update";
import { useLocalDependency } from "../../../src/commands/dependencies/useLocal";
import { uneditFolderDependency } from "../../../src/commands/dependencies/unedit";
import { resetPackage } from "../../../src/commands/resetPackage";
import * as utilities from "../../../src/commands/utilities";
import * as sinon from "sinon";
import { mockGlobalObject } from "../../MockUtils";

suite("PackageDependencyProvider Test Suite", function () {
    // Allow up to 2 minutes to build,
    // full workflow's interaction with spm is also longer than the default timeout
    this.timeout(2 * 60 * 1000);

    suite("PackageDependencyProvider Tree Node Tests", function () {
        let treeProvider: PackageDependenciesProvider;

        suiteSetup(async function () {
            const workspaceContext = await globalWorkspaceContextPromise;
            // workspace-state.json was not introduced until swift 5.7
            if (workspaceContext.toolchain.swiftVersion.isLessThan(new Version(5, 7, 0))) {
                this.skip();
            }
            await waitForNoRunningTasks();
            const folderContext = await folderContextPromise("dependencies");
            await executeTaskAndWaitForResult((await getBuildAllTask(folderContext)) as SwiftTask);
            await workspaceContext.focusFolder(folderContext);
            treeProvider = new PackageDependenciesProvider(workspaceContext);
        });

        suiteTeardown(() => {
            treeProvider?.dispose();
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

            expect(childFolder?.path).to.equal(
                `${testAssetPath("defaultPackage")}/Sources/PackageExe`
            );

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

    suite("Full work flow tests", function () {
        let folderContext: FolderContext;
        let workspaceContext: WorkspaceContext;
        const windowMock = mockGlobalObject(vscode, "window");

        suiteSetup(async function () {
            workspaceContext = await globalWorkspaceContextPromise;
            await waitForNoRunningTasks();
            folderContext = await folderContextPromise("dependencies");
            await workspaceContext.focusFolder(folderContext);
        });

        test("Use local dependency", async () => {
            // Expect to fail without setting up local version
            const tasks = (await getBuildAllTask(folderContext)) as SwiftTask;
            let { exitCode, output } = await executeTaskAndWaitForResult(tasks);
            expect(exitCode).to.not.equal(0);
            expect(output).to.include("PackageLib");
            expect(output).to.include("required");

            // Contract: spm reset, resolve, update should work
            const executeTaskSpy = sinon.spy(utilities, "executeTaskWithUI");
            await resolveDependencies(workspaceContext);
            await expect(executeTaskSpy.returnValues[0]).to.eventually.be.true;

            await updateDependencies(workspaceContext);
            await expect(executeTaskSpy.returnValues[1]).to.eventually.be.true;

            await resetPackage(workspaceContext);
            await expect(executeTaskSpy.returnValues[2]).to.eventually.be.true;
            await expect(executeTaskSpy.returnValues[3]).to.eventually.be.true;

            // Contract: spm edit with user supplied local version of dependency
            windowMock.showOpenDialog.resolves([testAssetUri("Swift-Markdown")]);
            const id = "swift-markdown";
            await useLocalDependency(id, workspaceContext);
            await expect(executeTaskSpy.returnValues[4]).to.eventually.be.true;

            // This will now pass as we have the required library
            ({ exitCode, output } = await executeTaskAndWaitForResult(tasks));
            expect(exitCode).to.equal(0);
            expect(output).to.include("defaultpackage");
            expect(output).to.include("not used by any target");

            // Contract: spm unedit
            const updateWorkspaceSpy = sinon.spy(vscode.workspace, "updateWorkspaceFolders");
            // We would love to call uneditDependency for coverage but there's no clean way to get
            // a synchronize point for deterministic task completion so just call this function direct
            await uneditFolderDependency(workspaceContext.currentFolder!, id, workspaceContext);
            expect(updateWorkspaceSpy.calledOnce).to.be.true;

            // Expect to fail again now dependency is missing
            ({ exitCode, output } = await executeTaskAndWaitForResult(tasks));
            expect(exitCode).to.not.equal(0);
            expect(output).to.include("PackageLib");
            expect(output).to.include("required");
        });
    });
});
