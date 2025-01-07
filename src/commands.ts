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

import * as vscode from "vscode";
import { WorkspaceContext } from "./WorkspaceContext";
import { PackageNode } from "./ui/PackageDependencyProvider";
import { SwiftToolchain } from "./toolchain/toolchain";
import { debugSnippet, runSnippet } from "./SwiftSnippets";
import { showToolchainSelectionQuickPick } from "./ui/ToolchainSelection";
import { captureDiagnostics } from "./commands/captureDiagnostics";
import { attachDebugger } from "./commands/attachDebugger";
import { reindexProject } from "./commands/reindexProject";
import { cleanBuild, debugBuild, runBuild } from "./commands/build";
import { runSwiftScript } from "./commands/runSwiftScript";
import { useLocalDependency } from "./commands/dependencies/useLocal";
import { editDependency } from "./commands/dependencies/edit";
import { uneditDependency } from "./commands/dependencies/unedit";
import { openInWorkspace } from "./commands/openInWorkspace";
import { openInExternalEditor } from "./commands/openInExternalEditor";
import { switchPlatform } from "./commands/switchPlatform";
import { insertFunctionComment } from "./commands/insertFunctionComment";
import { createNewProject } from "./commands/createNewProject";
import { openPackage } from "./commands/openPackage";
import { resolveDependencies } from "./commands/dependencies/resolve";
import { resetPackage } from "./commands/resetPackage";
import { updateDependencies } from "./commands/dependencies/update";
import { runPluginTask } from "./commands/runPluginTask";
import { runTestMultipleTimes } from "./commands/testMultipleTimes";
import { newSwiftFile } from "./commands/newFile";
import { runAllTestsParallel } from "./commands/runParallelTests";
import { evaluateExpression } from "./repl/command";

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
    toolchain: SwiftToolchain | undefined
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand("swift.createNewProject", () =>
            createNewProject(toolchain)
        ),
        vscode.commands.registerCommand("swift.selectToolchain", () =>
            showToolchainSelectionQuickPick(toolchain)
        ),
    ];
}

export enum Commands {
    RUN = "swift.run",
    DEBUG = "swift.debug",
    CLEAN_BUILD = "swift.cleanBuild",
    RESOLVE_DEPENDENCIES = "swift.resolveDependencies",
    UPDATE_DEPENDENCIES = "swift.updateDependencies",
    RUN_TESTS_MULTIPLE_TIMES = "swift.runTestsMultipleTimes",
    RESET_PACKAGE = "swift.resetPackage",
    USE_LOCAL_DEPENDENCY = "swift.useLocalDependency",
    UNEDIT_DEPENDENCY = "swift.uneditDependency",
    RUN_PLUGIN_TASK = "swift.runPluginTask",
    PREVIEW_DOCUMENTATION = "swift.previewDocumentation",
}

/**
 * Registers this extension's commands in the given {@link vscode.ExtensionContext context}.
 */
export function register(ctx: WorkspaceContext): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand("swift.newFile", uri => newSwiftFile(uri)),
        vscode.commands.registerCommand(Commands.RESOLVE_DEPENDENCIES, () =>
            resolveDependencies(ctx)
        ),
        vscode.commands.registerCommand(Commands.UPDATE_DEPENDENCIES, () =>
            updateDependencies(ctx)
        ),
        vscode.commands.registerCommand(Commands.RUN, () => runBuild(ctx)),
        vscode.commands.registerCommand(Commands.DEBUG, () => debugBuild(ctx)),
        vscode.commands.registerCommand(Commands.CLEAN_BUILD, () => cleanBuild(ctx)),
        vscode.commands.registerCommand(Commands.RUN_TESTS_MULTIPLE_TIMES, item => {
            if (ctx.currentFolder) {
                return runTestMultipleTimes(ctx.currentFolder, item, false);
            }
        }),
        vscode.commands.registerCommand("swift.runTestsUntilFailure", item => {
            if (ctx.currentFolder) {
                return runTestMultipleTimes(ctx.currentFolder, item, true);
            }
        }),
        // Note: This is only available on macOS (gated in `package.json`) because its the only OS that has the iOS SDK available.
        vscode.commands.registerCommand("swift.switchPlatform", () => switchPlatform()),
        vscode.commands.registerCommand(Commands.RESET_PACKAGE, () => resetPackage(ctx)),
        vscode.commands.registerCommand("swift.runScript", () => runSwiftScript(ctx)),
        vscode.commands.registerCommand("swift.openPackage", () => {
            if (ctx.currentFolder) {
                return openPackage(ctx.toolchain.swiftVersion, ctx.currentFolder.folder);
            }
        }),
        vscode.commands.registerCommand("swift.runSnippet", () => runSnippet(ctx)),
        vscode.commands.registerCommand("swift.debugSnippet", () => debugSnippet(ctx)),
        vscode.commands.registerCommand(Commands.RUN_PLUGIN_TASK, () => runPluginTask()),
        vscode.commands.registerCommand("swift.restartLSPServer", () =>
            ctx.languageClientManager.restart()
        ),
        vscode.commands.registerCommand("swift.reindexProject", () => reindexProject(ctx)),
        vscode.commands.registerCommand("swift.insertFunctionComment", () =>
            insertFunctionComment(ctx)
        ),
        vscode.commands.registerCommand(Commands.USE_LOCAL_DEPENDENCY, item => {
            if (item instanceof PackageNode) {
                return useLocalDependency(item.name, ctx);
            }
        }),
        vscode.commands.registerCommand("swift.editDependency", item => {
            if (item instanceof PackageNode) {
                return editDependency(item.name, ctx);
            }
        }),
        vscode.commands.registerCommand(Commands.UNEDIT_DEPENDENCY, item => {
            if (item instanceof PackageNode) {
                return uneditDependency(item.name, ctx);
            }
        }),
        vscode.commands.registerCommand("swift.openInWorkspace", item => {
            if (item instanceof PackageNode) {
                return openInWorkspace(item);
            }
        }),
        vscode.commands.registerCommand("swift.openExternal", item => {
            if (item instanceof PackageNode) {
                return openInExternalEditor(item);
            }
        }),
        vscode.commands.registerCommand("swift.attachDebugger", () => attachDebugger(ctx)),
        vscode.commands.registerCommand("swift.clearDiagnosticsCollection", () =>
            ctx.diagnostics.clear()
        ),
        vscode.commands.registerCommand("swift.captureDiagnostics", () => captureDiagnostics(ctx)),
        vscode.commands.registerCommand(
            "swift.runAllTestsParallel",
            async () => await runAllTestsParallel(ctx)
        ),
        vscode.commands.registerCommand(
            Commands.PREVIEW_DOCUMENTATION,
            async () => await ctx.documentation.launchDocumentationPreview()
        ),
        vscode.commands.registerCommand("swift.evaluate", () => evaluateExpression(ctx)),
    ];
}
