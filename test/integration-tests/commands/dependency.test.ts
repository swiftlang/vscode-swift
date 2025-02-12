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
import { testAssetUri } from "../../fixtures";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Commands } from "../../../src/commands";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../../utilities/tasks";
import { getBuildAllTask, SwiftTask } from "../../../src/tasks/SwiftTaskProvider";

suite("Dependency Commmands Test Suite", function () {
    // full workflow's interaction with spm is longer than the default timeout
    // 60 seconds for each test should be more than enough
    this.timeout(60 * 1000);

    let defaultContext: FolderContext;
    let depsContext: FolderContext;
    let workspaceContext: WorkspaceContext;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            defaultContext = await folderInRootWorkspace("defaultPackage", workspaceContext);
            depsContext = await folderInRootWorkspace("dependencies", workspaceContext);
            await waitForNoRunningTasks();
        },
    });

    test("Swift: Update Package Dependencies", async function () {
        await workspaceContext.focusFolder(defaultContext);
        const result = await vscode.commands.executeCommand(Commands.UPDATE_DEPENDENCIES);
        expect(result).to.be.true;
    });

    test("Swift: Resolve Package Dependencies", async function () {
        await workspaceContext.focusFolder(defaultContext);
        const result = await vscode.commands.executeCommand(Commands.RESOLVE_DEPENDENCIES);
        expect(result).to.be.true;
    });

    suite("Swift: Use Local Dependency", function () {
        let treeProvider: PackageDependenciesProvider;

        setup(async () => {
            await workspaceContext.focusFolder(depsContext);
            await executeTaskAndWaitForResult((await getBuildAllTask(depsContext)) as SwiftTask);
            treeProvider = new PackageDependenciesProvider(workspaceContext);
        });

        teardown(() => {
            treeProvider?.dispose();
        });

        async function getDependency() {
            const items = await treeProvider.getChildren();
            return items.find(n => n.name === "swift-markdown") as PackageNode;
        }

        // Wait for the dependency to switch to the expected state.
        // This doesn't happen immediately after the USE_LOCAL_DEPENDENCY
        // and RESET_PACKAGE commands because the file watcher on
        // workspace-state.json needs to trigger.
        async function getDependencyInState(state: "remote" | "editing") {
            for (let i = 0; i < 10; i++) {
                const dep = await getDependency();
                if (dep.type === state) {
                    return dep;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        async function useLocalDependencyTest() {
            // spm edit with user supplied local version of dependency
            const item = await getDependency();
            const localDep = testAssetUri("swift-markdown");
            const result = await vscode.commands.executeCommand(
                Commands.USE_LOCAL_DEPENDENCY,
                item,
                localDep
            );
            expect(result).to.be.true;

            const dep = await getDependencyInState("editing");
            expect(dep).to.not.be.undefined;
            // Make sure using local
            expect(dep?.type).to.equal("editing");
        }

        test("Swift: Reset Package Dependencies", async function () {
            // spm reset after using local dependency is broken on windows
            if (process.platform === "win32") {
                this.skip();
            }
            await useLocalDependencyTest();

            // spm reset
            const result = await vscode.commands.executeCommand(Commands.RESET_PACKAGE);
            expect(result).to.be.true;

            const dep = await getDependencyInState("remote");
            expect(dep).to.not.be.undefined;
            expect(dep?.type).to.equal("remote");
        });

        test("Swift: Revert To Original Version", async () => {
            await useLocalDependencyTest();

            const result = await vscode.commands.executeCommand(
                Commands.UNEDIT_DEPENDENCY,
                await getDependency()
            );
            expect(result).to.be.true;

            const dep = await getDependencyInState("remote");
            expect(dep).to.not.be.undefined;
            expect(dep?.type).to.equal("remote");
        });
    });
});
