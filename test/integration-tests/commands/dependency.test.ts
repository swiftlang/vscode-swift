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
import { beforeEach } from "mocha";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { ResolvedDependency } from "@src/SwiftPackage";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { Commands } from "@src/commands";

import { testAssetUri } from "../../fixtures";
import { tag } from "../../tags";
import { waitForNoRunningTasks } from "../../utilities/tasks";
import { activateExtensionForTest, findWorkspaceFolder } from "../utilities/testutilities";

tag("large").suite("Dependency Commands Test Suite", function () {
    let depsContext: FolderContext;
    let workspaceContext: WorkspaceContext;

    activateExtensionForTest({
        async setup(api) {
            const ctx = await api.waitForWorkspaceContext();
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

    // Skipping because these tests are currently flakey in CI
    suite.skip("Swift: Use Local Dependency", function () {
        setup(async () => {
            await waitForNoRunningTasks();
        });

        beforeEach(async function () {
            // Clean the Package.resolved before every test to ensure we start from a known state
            try {
                await fs.rm(path.join(depsContext.folder.fsPath, "Package.resolved"));
            } catch {
                // if we haven't done a resolve yet, the file won't exist
            }

            // Perform a resolve first to make sure that dependencies are up to date
            await vscode.commands.executeCommand(Commands.RESOLVE_DEPENDENCIES);

            workspaceContext.logger.info(
                "useLocalDependencyTest: Fetching the dependency in the 'remote' state"
            );

            // Get the dependency in remote state
            const remoteDep = await getDependencyInState("remote");
            const localDep = testAssetUri("swift-markdown");

            workspaceContext.logger.info(
                "useLocalDependencyTest: Resolving latest dependencies before editing"
            );

            workspaceContext.logger.info(`Configuring ${localDep.fsPath} to the "editing" state`);

            const result = await vscode.commands.executeCommand(
                Commands.USE_LOCAL_DEPENDENCY,
                createPackageNode(remoteDep),
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
        });

        /**
         * Get the swift-markdown dependency from the package dependencies
         */
        async function getSwiftMarkdownDependency(): Promise<ResolvedDependency | undefined> {
            // Reload workspace state to get latest dependency information
            await depsContext.reloadWorkspaceState();

            const dependencies = await depsContext.swiftPackage.rootDependencies;
            const swiftMarkdownDep = dependencies.find(
                dep => dep.identity.toLowerCase() === "swift-markdown"
            );

            workspaceContext.logger.info(
                `getSwiftMarkdownDependency: Found dependency with type "${swiftMarkdownDep?.type}"`
            );

            return swiftMarkdownDep;
        }

        /**
         * Create a PackageNode from a ResolvedDependency for use with commands
         */
        function createPackageNode(dependency: ResolvedDependency): any {
            return {
                __isPackageNode: true,
                name: dependency.identity,
                location: dependency.location,
                type: dependency.type,
                path: dependency.path ?? "",
                dependency: dependency,
            };
        }

        /**
         * Wait for the dependency to switch to the expected state.
         * This doesn't happen immediately after the USE_LOCAL_DEPENDENCY
         * and RESET_PACKAGE commands because the file watcher on
         * workspace-state.json needs to trigger.
         */
        async function getDependencyInState(
            state: "remote" | "editing"
        ): Promise<ResolvedDependency> {
            let currentDep: ResolvedDependency | undefined;

            for (let i = 0; i < 10; i++) {
                currentDep = await getSwiftMarkdownDependency();

                workspaceContext.logger.info(
                    `getDependencyInState: Current state of dependency is "${currentDep?.type}", waiting for "${state}"`
                );

                if (currentDep?.type === state) {
                    return currentDep;
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            const dependencies = await depsContext.swiftPackage.rootDependencies;
            const dependencyNames = dependencies.map(dep => dep.identity);

            throw Error(
                `Could not find swift-markdown dependency with state "${state}", instead it was "${currentDep?.type}". Available dependencies: ${dependencyNames.join(", ")}`
            );
        }

        test("Swift: Reset Package Dependencies", async function () {
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
            workspaceContext.logger.info("Unediting package dependency to original version");

            const editingDep = await getDependencyInState("editing");
            const result = await vscode.commands.executeCommand(
                Commands.UNEDIT_DEPENDENCY,
                createPackageNode(editingDep),
                depsContext
            );
            expect(result).to.be.true;

            const dep = await getDependencyInState("remote");
            expect(dep).to.not.be.undefined;
            expect(dep?.type).to.equal("remote");
        });
    });
});
