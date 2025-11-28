//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as path from "path";
import * as vscode from "vscode";

import { debugSnippet, runSnippet } from "./SwiftSnippets";
import { TestKind } from "./TestExplorer/TestKind";
import { WorkspaceContext } from "./WorkspaceContext";
import { attachDebugger } from "./commands/attachDebugger";
import { cleanBuild, debugBuild, runBuild } from "./commands/build";
import { captureDiagnostics } from "./commands/captureDiagnostics";
import { createNewProject } from "./commands/createNewProject";
import { editDependency } from "./commands/dependencies/edit";
import { resolveDependencies } from "./commands/dependencies/resolve";
import { uneditDependency } from "./commands/dependencies/unedit";
import { updateDependencies } from "./commands/dependencies/update";
import { updateDependenciesViewList } from "./commands/dependencies/updateDepViewList";
import { useLocalDependency } from "./commands/dependencies/useLocal";
import { generateLaunchConfigurations } from "./commands/generateLaunchConfigurations";
import { generateSourcekitConfiguration } from "./commands/generateSourcekitConfiguration";
import { insertFunctionComment } from "./commands/insertFunctionComment";
import { promptToInstallSwiftlyToolchain } from "./commands/installSwiftlyToolchain";
import { newSwiftFile } from "./commands/newFile";
import { openDocumentation } from "./commands/openDocumentation";
import { openEducationalNote } from "./commands/openEducationalNote";
import { openInExternalEditor } from "./commands/openInExternalEditor";
import { openInWorkspace } from "./commands/openInWorkspace";
import { openPackage } from "./commands/openPackage";
import { pickProcess } from "./commands/pickProcess";
import { reindexProject } from "./commands/reindexProject";
import { resetPackage } from "./commands/resetPackage";
import restartLSPServer from "./commands/restartLSPServer";
import { runAllTests } from "./commands/runAllTests";
import { runPlayground } from "./commands/runPlayground";
import { runPluginTask } from "./commands/runPluginTask";
import { runSwiftScript } from "./commands/runSwiftScript";
import { runTask } from "./commands/runTask";
import { runTest } from "./commands/runTest";
import { switchPlatform } from "./commands/switchPlatform";
import { extractTestItemsAndCount, runTestMultipleTimes } from "./commands/testMultipleTimes";
import { SwiftLogger } from "./logging/SwiftLogger";
import { SwiftToolchain } from "./toolchain/toolchain";
import { PackageNode, PlaygroundNode } from "./ui/ProjectPanelProvider";
import { showToolchainSelectionQuickPick } from "./ui/ToolchainSelection";

/**
 * References:
 *
 * - Contributing commands:
 *   https://code.visualstudio.com/api/references/contribution-points#contributes.commands
 * - Implementing commands:
 *   https://code.visualstudio.com/api/extension-guides/command
 */

export type WorkspaceContextWithToolchain = WorkspaceContext & { toolchain: SwiftToolchain };

export function registerToolchainCommands(
    ctx: WorkspaceContext | undefined,
    logger: SwiftLogger
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand("swift.createNewProject", () =>
            createNewProject(ctx?.globalToolchain)
        ),
        vscode.commands.registerCommand("swift.selectToolchain", () =>
            showToolchainSelectionQuickPick(
                ctx?.currentFolder?.toolchain ?? ctx?.globalToolchain,
                logger,
                ctx?.currentFolder?.folder
            )
        ),
        vscode.commands.registerCommand("swift.pickProcess", configuration =>
            pickProcess(configuration)
        ),
    ];
}

export enum Commands {
    RUN = "swift.run",
    DEBUG = "swift.debug",
    PLAY = "swift.play",
    CLEAN_BUILD = "swift.cleanBuild",
    RESOLVE_DEPENDENCIES = "swift.resolveDependencies",
    SHOW_FLAT_DEPENDENCIES_LIST = "swift.flatDependenciesList",
    SHOW_NESTED_DEPENDENCIES_LIST = "swift.nestedDependenciesList",
    UPDATE_DEPENDENCIES = "swift.updateDependencies",
    RUN_TESTS_MULTIPLE_TIMES = "swift.runTestsMultipleTimes",
    RUN_TESTS_UNTIL_FAILURE = "swift.runTestsUntilFailure",
    DEBUG_TESTS_MULTIPLE_TIMES = "swift.debugTestsMultipleTimes",
    DEBUG_TESTS_UNTIL_FAILURE = "swift.debugTestsUntilFailure",
    RESET_PACKAGE = "swift.resetPackage",
    USE_LOCAL_DEPENDENCY = "swift.useLocalDependency",
    UNEDIT_DEPENDENCY = "swift.uneditDependency",
    RUN_TASK = "swift.runTask",
    RUN_PLUGIN_TASK = "swift.runPluginTask",
    RUN_SNIPPET = "swift.runSnippet",
    DEBUG_SNIPPET = "swift.debugSnippet",
    PREVIEW_DOCUMENTATION = "swift.previewDocumentation",
    RUN_ALL_TESTS = "swift.runAllTests",
    RUN_ALL_TESTS_PARALLEL = "swift.runAllTestsParallel",
    DEBUG_ALL_TESTS = "swift.debugAllTests",
    COVER_ALL_TESTS = "swift.coverAllTests",
    RUN_TEST = "swift.runTest",
    DEBUG_TEST = "swift.debugTest",
    RUN_TEST_WITH_COVERAGE = "swift.runTestWithCoverage",
    OPEN_MANIFEST = "swift.openManifest",
    RESTART_LSP = "swift.restartLSPServer",
    SELECT_TOOLCHAIN = "swift.selectToolchain",
    INSTALL_SWIFTLY_TOOLCHAIN = "swift.installSwiftlyToolchain",
    INSTALL_SWIFTLY_SNAPSHOT_TOOLCHAIN = "swift.installSwiftlySnapshotToolchain",
    GENERATE_SOURCEKIT_CONFIG = "swift.generateSourcekitConfiguration",
}

/**
 * Registers this extension's commands in the given {@link vscode.ExtensionContext context}.
 */
export function register(ctx: WorkspaceContext): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand(
            "swift.generateLaunchConfigurations",
            async () => await generateLaunchConfigurations(ctx)
        ),
        vscode.commands.registerCommand("swift.newFile", async uri => await newSwiftFile(uri)),
        vscode.commands.registerCommand(
            Commands.RESOLVE_DEPENDENCIES,
            async () => await resolveDependencies(ctx)
        ),
        vscode.commands.registerCommand(
            Commands.UPDATE_DEPENDENCIES,
            async () => await updateDependencies(ctx)
        ),
        vscode.commands.registerCommand(
            Commands.RUN,
            async target => await runBuild(ctx, ...unwrapTreeItem(target))
        ),
        vscode.commands.registerCommand(
            Commands.DEBUG,
            async target => await debugBuild(ctx, ...unwrapTreeItem(target))
        ),
        vscode.commands.registerCommand(Commands.PLAY, async target => {
            const folder = ctx.currentFolder;
            if (!folder || !target) {
                return false;
            }
            return await runPlayground(
                folder,
                ctx.tasks,
                PlaygroundNode.isPlaygroundNode(target) ? target.playground : target
            );
        }),
        vscode.commands.registerCommand(Commands.CLEAN_BUILD, async () => await cleanBuild(ctx)),
        vscode.commands.registerCommand(
            Commands.RUN_TESTS_MULTIPLE_TIMES,
            async (...args: (vscode.TestItem | number)[]) => {
                const { testItems, count } = extractTestItemsAndCount(...args);
                if (ctx.currentFolder) {
                    return await runTestMultipleTimes(
                        ctx.currentFolder,
                        testItems,
                        false,
                        TestKind.standard,
                        count
                    );
                }
            }
        ),
        vscode.commands.registerCommand(
            Commands.RUN_TESTS_UNTIL_FAILURE,
            async (...args: (vscode.TestItem | number)[]) => {
                const { testItems, count } = extractTestItemsAndCount(...args);
                if (ctx.currentFolder) {
                    return await runTestMultipleTimes(
                        ctx.currentFolder,
                        testItems,
                        true,
                        TestKind.standard,
                        count
                    );
                }
            }
        ),

        vscode.commands.registerCommand(
            Commands.DEBUG_TESTS_MULTIPLE_TIMES,
            async (...args: (vscode.TestItem | number)[]) => {
                const { testItems, count } = extractTestItemsAndCount(...args);
                if (ctx.currentFolder) {
                    return await runTestMultipleTimes(
                        ctx.currentFolder,
                        testItems,
                        false,
                        TestKind.debug,
                        count
                    );
                }
            }
        ),
        vscode.commands.registerCommand(
            Commands.DEBUG_TESTS_UNTIL_FAILURE,
            async (...args: (vscode.TestItem | number)[]) => {
                const { testItems, count } = extractTestItemsAndCount(...args);
                if (ctx.currentFolder) {
                    return await runTestMultipleTimes(
                        ctx.currentFolder,
                        testItems,
                        true,
                        TestKind.debug,
                        count
                    );
                }
            }
        ),
        // Note: switchPlatform is only available on macOS and Swift 6.1 or later
        // (gated in `package.json`) because it's the only OS and toolchain combination that
        // has Darwin SDKs available and supports code editing with SourceKit-LSP
        vscode.commands.registerCommand(
            "swift.switchPlatform",
            async () => await switchPlatform(ctx)
        ),
        vscode.commands.registerCommand(
            Commands.RESET_PACKAGE,
            async (_ /* Ignore context */, folder) => await resetPackage(ctx, folder)
        ),
        vscode.commands.registerCommand("swift.runScript", async () => {
            if (ctx && vscode.window.activeTextEditor?.document) {
                await runSwiftScript(
                    vscode.window.activeTextEditor.document,
                    ctx.tasks,
                    ctx.currentFolder?.toolchain ?? ctx.globalToolchain
                );
            }
        }),
        vscode.commands.registerCommand("swift.openPackage", async () => {
            if (ctx.currentFolder) {
                return await openPackage(ctx.currentFolder.swiftVersion, ctx.currentFolder.folder);
            }
        }),
        vscode.commands.registerCommand(
            Commands.RUN_SNIPPET,
            async target => await runSnippet(ctx, ...unwrapTreeItem(target))
        ),
        vscode.commands.registerCommand(
            Commands.DEBUG_SNIPPET,
            async target => await debugSnippet(ctx, ...unwrapTreeItem(target))
        ),
        vscode.commands.registerCommand(
            Commands.RUN_PLUGIN_TASK,
            async () => await runPluginTask()
        ),
        vscode.commands.registerCommand(Commands.RUN_TASK, async name => await runTask(ctx, name)),
        vscode.commands.registerCommand(
            Commands.RESTART_LSP,
            async () => await restartLSPServer(ctx)
        ),
        vscode.commands.registerCommand(
            "swift.reindexProject",
            async () => await reindexProject(ctx)
        ),
        vscode.commands.registerCommand(
            "swift.insertFunctionComment",
            async () => await insertFunctionComment(ctx)
        ),
        vscode.commands.registerCommand(Commands.USE_LOCAL_DEPENDENCY, async (item, dep) => {
            if (PackageNode.isPackageNode(item)) {
                return await useLocalDependency(item.name, ctx, dep);
            }
        }),
        vscode.commands.registerCommand("swift.editDependency", async (item, folder) => {
            if (PackageNode.isPackageNode(item)) {
                return await editDependency(item.name, ctx, folder);
            }
        }),
        vscode.commands.registerCommand(Commands.UNEDIT_DEPENDENCY, async (item, folder) => {
            if (PackageNode.isPackageNode(item)) {
                return await uneditDependency(item.name, ctx, folder);
            }
        }),
        vscode.commands.registerCommand("swift.openInWorkspace", async item => {
            if (PackageNode.isPackageNode(item)) {
                return await openInWorkspace(item);
            }
        }),
        vscode.commands.registerCommand("swift.openExternal", item => {
            if (PackageNode.isPackageNode(item)) {
                return openInExternalEditor(item);
            }
        }),
        vscode.commands.registerCommand("swift.attachDebugger", attachDebugger),
        vscode.commands.registerCommand("swift.clearDiagnosticsCollection", () =>
            ctx.diagnostics.clear()
        ),
        vscode.commands.registerCommand(
            "swift.captureDiagnostics",
            async () => await captureDiagnostics(ctx)
        ),
        vscode.commands.registerCommand(
            Commands.RUN_ALL_TESTS_PARALLEL,
            async item => await runAllTests(ctx, TestKind.parallel, ...unwrapTreeItem(item))
        ),
        vscode.commands.registerCommand(
            Commands.RUN_ALL_TESTS,
            async item => await runAllTests(ctx, TestKind.standard, ...unwrapTreeItem(item))
        ),
        vscode.commands.registerCommand(
            Commands.DEBUG_ALL_TESTS,
            async item => await runAllTests(ctx, TestKind.debug, ...unwrapTreeItem(item))
        ),
        vscode.commands.registerCommand(
            Commands.COVER_ALL_TESTS,
            async item => await runAllTests(ctx, TestKind.coverage, ...unwrapTreeItem(item))
        ),
        vscode.commands.registerCommand(
            Commands.RUN_TEST,
            async item => await runTest(ctx, TestKind.standard, item)
        ),
        vscode.commands.registerCommand(
            Commands.DEBUG_TEST,
            async item => await runTest(ctx, TestKind.debug, item)
        ),
        vscode.commands.registerCommand(
            Commands.RUN_TEST_WITH_COVERAGE,
            async item => await runTest(ctx, TestKind.coverage, item)
        ),
        vscode.commands.registerCommand(
            Commands.PREVIEW_DOCUMENTATION,
            async () => await ctx.documentation.launchDocumentationPreview()
        ),
        vscode.commands.registerCommand(Commands.SHOW_FLAT_DEPENDENCIES_LIST, () =>
            updateDependenciesViewList(ctx, true)
        ),
        vscode.commands.registerCommand(Commands.SHOW_NESTED_DEPENDENCIES_LIST, () =>
            updateDependenciesViewList(ctx, false)
        ),
        vscode.commands.registerCommand("swift.openEducationalNote", uri =>
            openEducationalNote(uri)
        ),
        vscode.commands.registerCommand(Commands.OPEN_MANIFEST, async (uri: vscode.Uri) => {
            const packagePath = path.join(uri.fsPath, "Package.swift");
            await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(packagePath));
        }),
        vscode.commands.registerCommand("swift.openDocumentation", () => openDocumentation()),
        vscode.commands.registerCommand(
            Commands.GENERATE_SOURCEKIT_CONFIG,
            async () => await generateSourcekitConfiguration(ctx)
        ),
        vscode.commands.registerCommand(
            "swift.showCommands",
            async () =>
                await vscode.commands.executeCommand("workbench.action.quickOpen", ">Swift: ")
        ),
        vscode.commands.registerCommand(
            "swift.configureSettings",
            async () =>
                await vscode.commands.executeCommand(
                    "workbench.action.openSettings",
                    "@ext:swiftlang.swift-vscode "
                )
        ),
        vscode.commands.registerCommand(
            Commands.INSTALL_SWIFTLY_TOOLCHAIN,
            async () => await promptToInstallSwiftlyToolchain(ctx, "stable")
        ),
        vscode.commands.registerCommand(
            Commands.INSTALL_SWIFTLY_SNAPSHOT_TOOLCHAIN,
            async () => await promptToInstallSwiftlyToolchain(ctx, "snapshot")
        ),
    ];
}

/**
 * Certain commands can be called via a vscode TreeView, which will pass a {@link CommandNode} object.
 * If the command is called via a command palette or other means, the target will be a string.
 */
function unwrapTreeItem(target?: string | { args: string[] }): string[] {
    if (typeof target === "object" && target !== null && "args" in target) {
        return target.args ?? [];
    } else if (typeof target === "string") {
        return [target];
    }
    return [];
}
