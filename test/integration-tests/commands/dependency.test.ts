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
import { PackageNode, ProjectPanelProvider } from "../../../src/ui/ProjectPanelProvider";
import { testAssetUri } from "../../fixtures";
import { FolderContext } from "../../../src/FolderContext";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Commands } from "../../../src/commands";
import { activateExtensionForSuite, findWorkspaceFolder } from "../utilities/testutilities";
import { waitForNoRunningTasks } from "../../utilities/tasks";

suite("Dependency Commmands Test Suite @slow", function () {
    // full workflow's interaction with spm is longer than the default timeout
    // 3 minutes for each test should be more than enough
    this.timeout(3 * 60 * 1000);

    let depsContext: FolderContext;
    let workspaceContext: WorkspaceContext;

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            depsContext = findWorkspaceFolder("dependencies", workspaceContext)!;
        },
        testAssets: ["dependencies"],
    });

    setup(async () => {
        await workspaceContext.focusFolder(depsContext);
    });

    test("Swift: Update Package Dependencies", async function () {
        const result = await vscode.commands.executeCommand(Commands.UPDATE_DEPENDENCIES);
        expect(result).to.be.true;
    });

    test("Swift: Resolve Package Dependencies", async function () {
        const result = await vscode.commands.executeCommand(Commands.RESOLVE_DEPENDENCIES);
        expect(result).to.be.true;
    });

    suite("Swift: Use Local Dependency", function () {
        let treeProvider: ProjectPanelProvider;

        setup(async () => {
            await waitForNoRunningTasks();
            treeProvider = new ProjectPanelProvider(workspaceContext);
        });

        teardown(() => {
            treeProvider?.dispose();
        });

        async function getDependency() {
            const headers = await treeProvider.getChildren();
            const header = headers.find(n => n.name === "Dependencies") as PackageNode;
            if (!header) {
                return;
            }
            const children = await header.getChildren();
            return children.find(
                n => n.name.toLocaleLowerCase() === "swift-markdown"
            ) as PackageNode;
        }

        // Wait for the dependency to switch to the expected state.
        // This doesn't happen immediately after the USE_LOCAL_DEPENDENCY
        // and RESET_PACKAGE commands because the file watcher on
        // workspace-state.json needs to trigger.
        async function getDependencyInState(state: "remote" | "editing") {
            for (let i = 0; i < 10; i++) {
                const dep = await getDependency();
                if (dep?.type === state) {
                    return dep;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            throw Error(`Could not find dependency with state "${state}"`);
        }

        async function useLocalDependencyTest() {
            // spm edit with user supplied local version of dependency
            const item = await getDependencyInState("remote");
            const localDep = testAssetUri("swift-markdown");
            const result = await vscode.commands.executeCommand(
                Commands.USE_LOCAL_DEPENDENCY,
                item,
                localDep,
                depsContext
            );
            expect(result).to.be.true;

            const dep = await getDependencyInState("editing");
            expect(dep).to.not.be.undefined;
            // Make sure using local
            expect(dep?.type).to.equal("editing");
        }

        test("Swift: Reset Package Dependencies", async function () {
            await useLocalDependencyTest();

            // spm reset
            const result = await vscode.commands.executeCommand(
                Commands.RESET_PACKAGE,
                depsContext
            );
            expect(result).to.be.true;

            const dep = await getDependencyInState("remote");
            expect(dep).to.not.be.undefined;
            expect(dep?.type).to.equal("remote");
        });

        test("Swift: Revert To Original Version", async function () {
            await useLocalDependencyTest();

            const result = await vscode.commands.executeCommand(
                Commands.UNEDIT_DEPENDENCY,
                await getDependencyInState("editing"),
                depsContext
            );
            expect(result).to.be.true;

            const dep = await getDependencyInState("remote");
            expect(dep).to.not.be.undefined;
            expect(dep?.type).to.equal("remote");
        });
    });
});
