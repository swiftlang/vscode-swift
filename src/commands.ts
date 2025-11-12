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

import { InternalSwiftExtensionApi } from "./InternalSwiftExtensionApi";
import { debugSnippet, runSnippet } from "./SwiftSnippets";
import { TestKind } from "./TestExplorer/TestKind";
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
export function registerCommands(api: InternalSwiftExtensionApi): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand("swift.createNewProject", () =>
            api.withWorkspaceContext<void>(ctx => createNewProject(ctx.globalToolchain))
        ),
        vscode.commands.registerCommand("swift.selectToolchain", () =>
            api.withWorkspaceContext(ctx =>
                showToolchainSelectionQuickPick(
                    ctx.currentFolder?.toolchain ?? ctx.globalToolchain,
                    api.logger,
                    ctx.currentFolder?.folder
                )
            )
        ),
        vscode.commands.registerCommand("swift.pickProcess", configuration =>
            pickProcess(configuration)
        ),
        vscode.commands.registerCommand("swift.generateLaunchConfigurations", () =>
            api.withWorkspaceContext(ctx => generateLaunchConfigurations(ctx))
        ),
        vscode.commands.registerCommand("swift.newFile", uri => newSwiftFile(uri)),
        vscode.commands.registerCommand(Commands.RESOLVE_DEPENDENCIES, () =>
            api.withWorkspaceContext(ctx => resolveDependencies(ctx))
        ),
        vscode.commands.registerCommand(Commands.UPDATE_DEPENDENCIES, () =>
            api.withWorkspaceContext(ctx => updateDependencies(ctx))
        ),
        vscode.commands.registerCommand(Commands.RUN, target =>
            api.withWorkspaceContext(ctx => runBuild(ctx, ...unwrapTreeItem(target)))
        ),
        vscode.commands.registerCommand(Commands.DEBUG, target =>
            api.withWorkspaceContext(ctx => debugBuild(ctx, ...unwrapTreeItem(target)))
        ),
        vscode.commands.registerCommand(Commands.PLAY, target =>
            api.withWorkspaceContext(async ctx => {
                const folder = ctx.currentFolder;
                if (!folder || !target) {
                    return false;
                }
                return await runPlayground(
                    folder,
                    ctx.tasks,
                    PlaygroundNode.isPlaygroundNode(target) ? target.playground : target
                );
            })
        ),
        vscode.commands.registerCommand(Commands.CLEAN_BUILD, () =>
            api.withWorkspaceContext(ctx => cleanBuild(ctx))
        ),
        vscode.commands.registerCommand(
            Commands.RUN_TESTS_MULTIPLE_TIMES,
            (...args: (vscode.TestItem | number)[]) => {
                const { testItems, count } = extractTestItemsAndCount(...args);
                return api.withWorkspaceContext(async ctx => {
                    if (!ctx.currentFolder) {
                        return undefined;
                    }
                    return await runTestMultipleTimes(
                        ctx.currentFolder,
                        testItems,
                        false,
                        TestKind.standard,
                        count
                    );
                });
            }
        ),
        vscode.commands.registerCommand(
            Commands.RUN_TESTS_UNTIL_FAILURE,
            async (...args: (vscode.TestItem | number)[]) => {
                const { testItems, count } = extractTestItemsAndCount(...args);
                return api.withWorkspaceContext(async ctx => {
                    if (!ctx.currentFolder) {
                        return undefined;
                    }
                    return await runTestMultipleTimes(
                        ctx.currentFolder,
                        testItems,
                        true,
                        TestKind.standard,
                        count
                    );
                });
            }
        ),

        vscode.commands.registerCommand(
            Commands.DEBUG_TESTS_MULTIPLE_TIMES,
            async (...args: (vscode.TestItem | number)[]) => {
                const { testItems, count } = extractTestItemsAndCount(...args);
                return api.withWorkspaceContext(async ctx => {
                    if (!ctx.currentFolder) {
                        return undefined;
                    }
                    return await runTestMultipleTimes(
                        ctx.currentFolder,
                        testItems,
                        false,
                        TestKind.debug,
                        count
                    );
                });
            }
        ),
        vscode.commands.registerCommand(
            Commands.DEBUG_TESTS_UNTIL_FAILURE,
            async (...args: (vscode.TestItem | number)[]) => {
                const { testItems, count } = extractTestItemsAndCount(...args);
                return api.withWorkspaceContext(async ctx => {
                    if (!ctx.currentFolder) {
                        return undefined;
                    }
                    return await runTestMultipleTimes(
                        ctx.currentFolder,
                        testItems,
                        true,
                        TestKind.debug,
                        count
                    );
                });
            }
        ),
        // Note: switchPlatform is only available on macOS and Swift 6.1 or later
        // (gated in `package.json`) because it's the only OS and toolchain combination that
        // has Darwin SDKs available and supports code editing with SourceKit-LSP
        vscode.commands.registerCommand("swift.switchPlatform", () =>
            api.withWorkspaceContext(ctx => switchPlatform(ctx))
        ),
        vscode.commands.registerCommand(Commands.RESET_PACKAGE, (_ /* Ignore context */, folder) =>
            api.withWorkspaceContext(ctx => resetPackage(ctx, folder))
        ),
        vscode.commands.registerCommand("swift.runScript", () =>
            api.withWorkspaceContext(async ctx => {
                if (!ctx || !vscode.window.activeTextEditor?.document) {
                    return undefined;
                }
                return await runSwiftScript(
                    vscode.window.activeTextEditor.document,
                    ctx.tasks,
                    ctx.currentFolder?.toolchain ?? ctx.globalToolchain
                );
            })
        ),
        vscode.commands.registerCommand("swift.openPackage", () =>
            api.withWorkspaceContext(async ctx => {
                if (ctx.currentFolder) {
                    return await openPackage(
                        ctx.currentFolder.swiftVersion,
                        ctx.currentFolder.folder
                    );
                }
            })
        ),
        vscode.commands.registerCommand(Commands.RUN_SNIPPET, target =>
            api.withWorkspaceContext(ctx => runSnippet(ctx, ...unwrapTreeItem(target)))
        ),
        vscode.commands.registerCommand(Commands.DEBUG_SNIPPET, target =>
            api.withWorkspaceContext(ctx => debugSnippet(ctx, ...unwrapTreeItem(target)))
        ),
        vscode.commands.registerCommand(Commands.RUN_PLUGIN_TASK, () => () => runPluginTask()),
        vscode.commands.registerCommand(Commands.RUN_TASK, name => runTask(api, name)),
        vscode.commands.registerCommand(Commands.RESTART_LSP, () =>
            api.withWorkspaceContext(ctx => restartLSPServer(ctx))
        ),
        vscode.commands.registerCommand("swift.reindexProject", () =>
            api.withWorkspaceContext(ctx => reindexProject(ctx))
        ),
        vscode.commands.registerCommand("swift.insertFunctionComment", () =>
            api.withWorkspaceContext(ctx => insertFunctionComment(ctx))
        ),
        vscode.commands.registerCommand(Commands.USE_LOCAL_DEPENDENCY, (item, dep) =>
            api.withWorkspaceContext(async ctx => {
                if (PackageNode.isPackageNode(item)) {
                    return await useLocalDependency(item.name, ctx, dep);
                }
            })
        ),
        vscode.commands.registerCommand("swift.editDependency", (item, folder) =>
            api.withWorkspaceContext(async ctx => {
                if (PackageNode.isPackageNode(item)) {
                    return await editDependency(item.name, ctx, folder);
                }
            })
        ),
        vscode.commands.registerCommand(Commands.UNEDIT_DEPENDENCY, (item, folder) =>
            api.withWorkspaceContext(async ctx => {
                if (PackageNode.isPackageNode(item)) {
                    return await uneditDependency(item.name, ctx, folder);
                }
            })
        ),
        vscode.commands.registerCommand("swift.openInWorkspace", item => {
            if (PackageNode.isPackageNode(item)) {
                return openInWorkspace(item);
            }
        }),
        vscode.commands.registerCommand("swift.openExternal", item => {
            if (PackageNode.isPackageNode(item)) {
                return openInExternalEditor(item);
            }
        }),
        vscode.commands.registerCommand("swift.attachDebugger", attachDebugger),
        vscode.commands.registerCommand("swift.clearDiagnosticsCollection", () =>
            api.withWorkspaceContext(ctx => ctx.diagnostics.clear())
        ),
        vscode.commands.registerCommand("swift.captureDiagnostics", () =>
            api.withWorkspaceContext(ctx => captureDiagnostics(ctx))
        ),
        vscode.commands.registerCommand(Commands.RUN_ALL_TESTS_PARALLEL, item =>
            api.withWorkspaceContext(ctx =>
                runAllTests(ctx, TestKind.parallel, ...unwrapTreeItem(item))
            )
        ),
        vscode.commands.registerCommand(Commands.RUN_ALL_TESTS, item =>
            api.withWorkspaceContext(ctx =>
                runAllTests(ctx, TestKind.standard, ...unwrapTreeItem(item))
            )
        ),
        vscode.commands.registerCommand(Commands.DEBUG_ALL_TESTS, item =>
            api.withWorkspaceContext(ctx =>
                runAllTests(ctx, TestKind.debug, ...unwrapTreeItem(item))
            )
        ),
        vscode.commands.registerCommand(Commands.COVER_ALL_TESTS, item =>
            api.withWorkspaceContext(ctx =>
                runAllTests(ctx, TestKind.coverage, ...unwrapTreeItem(item))
            )
        ),
        vscode.commands.registerCommand(Commands.RUN_TEST, item =>
            api.withWorkspaceContext(ctx => runTest(ctx, TestKind.standard, item))
        ),
        vscode.commands.registerCommand(Commands.DEBUG_TEST, item =>
            api.withWorkspaceContext(ctx => runTest(ctx, TestKind.debug, item))
        ),
        vscode.commands.registerCommand(Commands.RUN_TEST_WITH_COVERAGE, item =>
            api.withWorkspaceContext(ctx => runTest(ctx, TestKind.coverage, item))
        ),
        vscode.commands.registerCommand(Commands.PREVIEW_DOCUMENTATION, () =>
            api.withWorkspaceContext(ctx => ctx.documentation.launchDocumentationPreview())
        ),
        vscode.commands.registerCommand(Commands.SHOW_FLAT_DEPENDENCIES_LIST, () =>
            api.withWorkspaceContext(ctx => updateDependenciesViewList(ctx, true))
        ),
        vscode.commands.registerCommand(Commands.SHOW_NESTED_DEPENDENCIES_LIST, () =>
            api.withWorkspaceContext(ctx => updateDependenciesViewList(ctx, false))
        ),
        vscode.commands.registerCommand("swift.openEducationalNote", uri =>
            openEducationalNote(uri)
        ),
        vscode.commands.registerCommand(Commands.OPEN_MANIFEST, async (uri: vscode.Uri) => {
            const packagePath = path.join(uri.fsPath, "Package.swift");
            await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(packagePath));
        }),
        vscode.commands.registerCommand("swift.openDocumentation", () => openDocumentation()),
        vscode.commands.registerCommand(Commands.GENERATE_SOURCEKIT_CONFIG, () =>
            api.withWorkspaceContext(ctx => generateSourcekitConfiguration(ctx))
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
        vscode.commands.registerCommand(Commands.INSTALL_SWIFTLY_TOOLCHAIN, () =>
            api.withWorkspaceContext(ctx => promptToInstallSwiftlyToolchain(ctx, "stable"))
        ),
        vscode.commands.registerCommand(Commands.INSTALL_SWIFTLY_SNAPSHOT_TOOLCHAIN, () =>
            api.withWorkspaceContext(ctx => promptToInstallSwiftlyToolchain(ctx, "snapshot"))
        ),
    ];
}

/**
 * Certain commands can be called via a vscode TreeView, which will pass a {@link CommandNode} object.
 * If the command is called via a command palette or other means, the target will be a string.
 */
function unwrapTreeItem(target?: string | { args: string[] }): string[] {
    if (!!target && typeof target === "object" && "args" in target) {
        return target.args ?? [];
    } else if (typeof target === "string") {
        return [target];
    }
    return [];
}
