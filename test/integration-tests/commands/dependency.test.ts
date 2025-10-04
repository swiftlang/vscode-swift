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
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { Commands } from "@src/commands";
import { PackageNode, ProjectPanelProvider } from "@src/ui/ProjectPanelProvider";

import { testAssetUri } from "../../fixtures";
import { tag } from "../../tags";
import { waitForNoRunningTasks } from "../../utilities/tasks";
import {
    activateExtensionForSuite,
    findWorkspaceFolder,
    folderInRootWorkspace,
} from "../utilities/testutilities";

tag("large").suite("Dependency Commands Test Suite", function () {
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
            workspaceContext.logger.info(
                `getDependency: Current headers: ${headers.map(n => n.name)}`
            );
            if (!header) {
                return;
            }

            const children = await header.getChildren();
            workspaceContext.logger.info(
                `getDependencyInState: Current children for "Dependencies" entry: ${children.map(n => n.name).join(", ")}`
            );
            return children.find(
                n => n.name.toLocaleLowerCase() === "swift-markdown"
            ) as PackageNode;
        }

        // Wait for the dependency to switch to the expected state.
        // This doesn't happen immediately after the USE_LOCAL_DEPENDENCY
        // and RESET_PACKAGE commands because the file watcher on
        // workspace-state.json needs to trigger.
        async function getDependencyInState(state: "remote" | "editing") {
            let depType: string | undefined;
            for (let i = 0; i < 10; i++) {
                const dep = await getDependency();
                if (dep?.type === state) {
                    return dep;
                }
                depType = dep?.type;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            const headers = await treeProvider.getChildren();
            const headerNames = headers.map(n => n.name);
            const depChildren = await (
                headers.find(n => n.name === "Dependencies") as PackageNode
            )?.getChildren();
            const childrenNames = depChildren?.map(n => n.name) ?? [];

            const dependenciesFolderContext = await folderInRootWorkspace(
                "dependencies",
                workspaceContext
            );
            const resolvedPath = path.join(
                dependenciesFolderContext.folder.fsPath,
                "Package.resolved"
            );
            const packageResolvedContents = await fs.readFile(resolvedPath, "utf8");

            throw Error(
                `Could not find dependency with state "${state}", instead it was "${depType}". Current headers: ${headerNames.map(h => `"${h}"`).join(", ")}, Current children for "Dependencies" entry: ${childrenNames.map(c => `"${c}"`).join(", ")}\nContents of Package.resolved:\n${packageResolvedContents}`
            );
        }

        async function useLocalDependencyTest() {
            workspaceContext.logger.info(
                "useLocalDependencyTest: Fetching the dependency in the 'remote' state"
            );

            // spm edit with user supplied local version of dependency
            const item = await getDependencyInState("remote");
            const localDep = testAssetUri("swift-markdown");

            workspaceContext.logger.info(
                "useLocalDependencyTest: Resolving latest dependencies before editing"
            );

            // Perform a resolve first to make sure that dependencies are up to date
            await vscode.commands.executeCommand(Commands.RESOLVE_DEPENDENCIES);

            workspaceContext.logger.info(`Configuring ${localDep.fsPath} to the "editing" state`);

            const result = await vscode.commands.executeCommand(
                Commands.USE_LOCAL_DEPENDENCY,
                item,
                localDep,
                depsContext
            );
            expect(result).to.be.true;

            workspaceContext.logger.info(
                "useLocalDependencyTest: Set use local dependency to remote, now verifying"
            );

            const dep = await getDependencyInState("editing");
            expect(dep).to.not.be.undefined;
            // Make sure using local
            expect(dep?.type).to.equal("editing");

            workspaceContext.logger.info(
                "useLocalDependencyTest: Use local dependency was verified to be in 'editing' state"
            );
        }

        test("Swift: Reset Package Dependencies", async function () {
            await useLocalDependencyTest();

            workspaceContext.logger.info("Resetting package dependency to remote version");

            // spm reset
            const result = await vscode.commands.executeCommand(
                Commands.RESET_PACKAGE,
                undefined,
                depsContext
            );
            expect(result).to.be.true;

            const dep = await getDependencyInState("remote");
            expect(dep).to.not.be.undefined;
            expect(dep?.type).to.equal("remote");
        });

        test("Swift: Unedit To Original Version", async function () {
            await useLocalDependencyTest();

            workspaceContext.logger.info("Unediting package dependency to original version");

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
