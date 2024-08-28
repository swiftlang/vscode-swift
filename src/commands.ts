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

/**
 * Registers this extension's commands in the given {@link vscode.ExtensionContext context}.
 */
export function register(ctx: WorkspaceContext): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand("swift.newFile", uri => newSwiftFile(uri)),
        vscode.commands.registerCommand("swift.resolveDependencies", () =>
            resolveDependencies(ctx)
        ),
        vscode.commands.registerCommand("swift.updateDependencies", () => updateDependencies(ctx)),
        vscode.commands.registerCommand("swift.run", () => runBuild(ctx)),
        vscode.commands.registerCommand("swift.debug", () => debugBuild(ctx)),
        vscode.commands.registerCommand("swift.cleanBuild", () => cleanBuild(ctx)),
        vscode.commands.registerCommand("swift.runTestsMultipleTimes", item =>
            runTestMultipleTimes(ctx, item, false)
        ),
        vscode.commands.registerCommand("swift.runTestsUntilFailure", item =>
            runTestMultipleTimes(ctx, item, true)
        ),
        // Note: This is only available on macOS (gated in `package.json`) because its the only OS that has the iOS SDK available.
        vscode.commands.registerCommand("swift.switchPlatform", () => switchPlatform()),
        vscode.commands.registerCommand("swift.resetPackage", () => resetPackage(ctx)),
        vscode.commands.registerCommand("swift.runScript", () => runSwiftScript(ctx)),
        vscode.commands.registerCommand("swift.openPackage", () => openPackage(ctx)),
        vscode.commands.registerCommand("swift.runSnippet", () => runSnippet(ctx)),
        vscode.commands.registerCommand("swift.debugSnippet", () => debugSnippet(ctx)),
        vscode.commands.registerCommand("swift.runPluginTask", () => runPluginTask()),
        vscode.commands.registerCommand("swift.restartLSPServer", () =>
            ctx.languageClientManager.restart()
        ),
        vscode.commands.registerCommand("swift.reindexProject", () => reindexProject(ctx)),
        vscode.commands.registerCommand("swift.insertFunctionComment", () =>
            insertFunctionComment(ctx)
        ),
        vscode.commands.registerCommand("swift.useLocalDependency", item => {
            if (item instanceof PackageNode) {
                useLocalDependency(item.name, ctx);
            }
        }),
        vscode.commands.registerCommand("swift.editDependency", item => {
            if (item instanceof PackageNode) {
                editDependency(item.name, ctx);
            }
        }),
        vscode.commands.registerCommand("swift.uneditDependency", item => {
            if (item instanceof PackageNode) {
                uneditDependency(item.name, ctx);
            }
        }),
        vscode.commands.registerCommand("swift.openInWorkspace", item => {
            if (item instanceof PackageNode) {
                openInWorkspace(item);
            }
        }),
        vscode.commands.registerCommand("swift.openExternal", item => {
            if (item instanceof PackageNode) {
                openInExternalEditor(item);
            }
        }),
        vscode.commands.registerCommand("swift.attachDebugger", () => attachDebugger(ctx)),
        vscode.commands.registerCommand("swift.clearDiagnosticsCollection", () =>
            ctx.diagnostics.clear()
        ),
        vscode.commands.registerCommand("swift.captureDiagnostics", () => captureDiagnostics(ctx)),
    ];
}
