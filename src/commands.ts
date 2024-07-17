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
import * as fs from "fs/promises";
import * as path from "path";
import configuration from "./configuration";
import { FolderEvent, WorkspaceContext } from "./WorkspaceContext";
import { createSwiftTask, SwiftTaskProvider } from "./tasks/SwiftTaskProvider";
import { FolderContext } from "./FolderContext";
import { PackageNode } from "./ui/PackageDependencyProvider";
import { withQuickPick } from "./ui/QuickPick";
import { withDelayedProgress } from "./ui/withDelayedProgress";
import { execSwift, getErrorDescription } from "./utilities/utilities";
import { Version } from "./utilities/version";
import { DarwinCompatibleTarget, SwiftToolchain } from "./toolchain/toolchain";
import { debugSnippet, runSnippet } from "./SwiftSnippets";
import { debugLaunchConfig, getLaunchConfiguration } from "./debugger/launch";
import { execFile } from "./utilities/utilities";
import { SwiftExecOperation, TaskOperation } from "./tasks/TaskQueue";
import { SwiftProjectTemplate } from "./toolchain/toolchain";
import { showToolchainSelectionQuickPick, showToolchainError } from "./ui/ToolchainSelection";
import { captureDiagnostics } from "./commands/captureDiagnostics";
import { reindexProjectRequest } from "./sourcekit-lsp/lspExtensions";

/**
 * References:
 *
 * - Contributing commands:
 *   https://code.visualstudio.com/api/references/contribution-points#contributes.commands
 * - Implementing commands:
 *   https://code.visualstudio.com/api/extension-guides/command
 */

export type WorkspaceContextWithToolchain = WorkspaceContext & { toolchain: SwiftToolchain };

/**
 * Executes a {@link vscode.Task task} to resolve this package's dependencies.
 */
export async function resolveDependencies(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    await resolveFolderDependencies(current);
}

/**
 * Run `swift package resolve` inside a folder
 * @param folderContext folder to run resolve for
 */
export async function resolveFolderDependencies(
    folderContext: FolderContext,
    checkAlreadyRunning?: boolean
) {
    const task = createSwiftTask(
        ["package", "resolve"],
        SwiftTaskProvider.resolvePackageName,
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            prefix: folderContext.name,
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
        },
        folderContext.workspaceContext.toolchain
    );

    await executeTaskWithUI(
        task,
        "Resolving Dependencies",
        folderContext,
        false,
        checkAlreadyRunning
    ).then(result => {
        updateAfterError(result, folderContext);
    });
}

/**
 * Executes a {@link vscode.Task task} to update this package's dependencies.
 */
export async function updateDependencies(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    await updateFolderDependencies(current);
}

/**
 * Prompts the user to input project details and then executes `swift package init`
 * to create the project.
 */
export async function createNewProject(toolchain: SwiftToolchain | undefined): Promise<void> {
    // It is possible for this command to be run without a valid toolchain because it can be
    // run before the Swift extension is activated. Show the toolchain error notification in
    // this case.
    if (!toolchain) {
        showToolchainError();
        return;
    }

    // The context key `swift.createNewProjectAvailable` only works if the extension has been
    // activated. As such, we also have to allow this command to run when no workspace is
    // active. Show an error to the user if the command is unavailable.
    if (!toolchain.swiftVersion.isGreaterThanOrEqual(new Version(5, 8, 0))) {
        vscode.window.showErrorMessage(
            "Creating a new swift project is only available starting in swift version 5.8.0."
        );
        return;
    }

    // Prompt the user for the type of project they would like to create
    const availableProjectTemplates = await toolchain.getProjectTemplates();
    const selectedProjectTemplate = await vscode.window.showQuickPick<
        vscode.QuickPickItem & { type: SwiftProjectTemplate }
    >(
        availableProjectTemplates.map(type => ({
            label: type.name,
            description: type.id,
            detail: type.description,
            type,
        })),
        {
            placeHolder: "Select a swift project template",
        }
    );
    if (!selectedProjectTemplate) {
        return undefined;
    }
    const projectType = selectedProjectTemplate.type.id;

    // Prompt the user for a location in which to create the new project
    const selectedFolder = await vscode.window.showOpenDialog({
        title: "Select a folder to create a new swift project in",
        openLabel: "Select folder",
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
    });
    if (!selectedFolder || selectedFolder.length === 0) {
        return undefined;
    }

    // Prompt the user for the project name
    const existingNames = await fs.readdir(selectedFolder[0].fsPath, { encoding: "utf-8" });
    let initialValue = `swift-${projectType}`;
    for (let i = 1; ; i++) {
        if (!existingNames.includes(initialValue)) {
            break;
        }
        initialValue = `swift-${projectType}-${i}`;
    }
    const projectName = await vscode.window.showInputBox({
        value: initialValue,
        prompt: "Enter a name for your new swift project",
        validateInput(value) {
            // Swift Package Manager doesn't seem to do any validation on the name.
            // So, we'll just check for obvious failure cases involving mkdir.
            if (value.trim() === "") {
                return "Project name cannot be empty.";
            } else if (value.includes("/") || value.includes("\\")) {
                return "Project name cannot contain '/' or '\\' characters.";
            } else if (value === "." || value === "..") {
                return "Project name cannot be '.' or '..'.";
            }
            // Ensure there are no name collisions
            if (existingNames.includes(value)) {
                return "A file/folder with this name already exists.";
            }
            return undefined;
        },
    });
    if (projectName === undefined) {
        return undefined;
    }

    // Create the folder that will store the new project
    const projectUri = vscode.Uri.joinPath(selectedFolder[0], projectName);
    await fs.mkdir(projectUri.fsPath);

    // Use swift package manager to initialize the swift project
    await withDelayedProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Creating swift project ${projectName}`,
        },
        async () => {
            await execSwift(
                ["package", "init", "--type", projectType, "--name", projectName],
                toolchain,
                {
                    cwd: projectUri.fsPath,
                }
            );
        },
        1000
    );

    // Prompt the user whether or not they want to open the newly created project
    const isWorkspaceOpened = !!vscode.workspace.workspaceFolders;
    const openAfterCreate = configuration.openAfterCreateNewProject;

    let action: "open" | "openNewWindow" | "addToWorkspace" | undefined;
    if (openAfterCreate === "always") {
        action = "open";
    } else if (openAfterCreate === "alwaysNewWindow") {
        action = "openNewWindow";
    } else if (openAfterCreate === "whenNoFolderOpen" && !isWorkspaceOpened) {
        action = "open";
    }

    if (action === undefined) {
        let message = `Would you like to open ${projectName}?`;
        const open = "Open";
        const openNewWindow = "Open in New Window";
        const choices = [open, openNewWindow];

        const addToWorkspace = "Add to Workspace";
        if (isWorkspaceOpened) {
            message = `Would you like to open ${projectName}, or add it to the current workspace?`;
            choices.push(addToWorkspace);
        }

        const result = await vscode.window.showInformationMessage(
            message,
            { modal: true, detail: "The default action can be configured in settings" },
            ...choices
        );
        if (result === open) {
            action = "open";
        } else if (result === openNewWindow) {
            action = "openNewWindow";
        } else if (result === addToWorkspace) {
            action = "addToWorkspace";
        }
    }

    if (action === "open") {
        await vscode.commands.executeCommand("vscode.openFolder", projectUri, {
            forceReuseWindow: true,
        });
    } else if (action === "openNewWindow") {
        await vscode.commands.executeCommand("vscode.openFolder", projectUri, {
            forceNewWindow: true,
        });
    } else if (action === "addToWorkspace") {
        const index = vscode.workspace.workspaceFolders?.length ?? 0;
        await vscode.workspace.updateWorkspaceFolders(index, 0, { uri: projectUri });
    }
}

/**
 * Run `swift package update` inside a folder
 * @param folderContext folder to run update inside
 * @returns
 */
export async function updateFolderDependencies(folderContext: FolderContext) {
    const task = createSwiftTask(
        ["package", "update"],
        SwiftTaskProvider.updatePackageName,
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            prefix: folderContext.name,
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
        },
        folderContext.workspaceContext.toolchain
    );

    await executeTaskWithUI(task, "Updating Dependencies", folderContext).then(result => {
        updateAfterError(result, folderContext);
    });
}

/**
 * Executes a {@link vscode.Task task} to run swift target.
 */
export async function runBuild(ctx: WorkspaceContext) {
    await debugBuildWithOptions(ctx, { noDebug: true });
}

/**
 * Executes a {@link vscode.Task task} to debug swift target.
 */
export async function debugBuild(ctx: WorkspaceContext) {
    await debugBuildWithOptions(ctx, {});
}

/**
 * Executes a {@link vscode.Task task} to debug swift target.
 */
async function debugBuildWithOptions(ctx: WorkspaceContext, options: vscode.DebugSessionOptions) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    const file = vscode.window.activeTextEditor?.document.fileName;
    if (!file) {
        return;
    }
    const target = current.swiftPackage.getTarget(file);
    if (!target || target.type !== "executable") {
        return;
    }
    const launchConfig = getLaunchConfiguration(target.name, current);
    if (launchConfig) {
        return debugLaunchConfig(current.workspaceFolder, launchConfig, options);
    }
}

/**
 * Executes a {@link vscode.Task task} to delete all build artifacts.
 */
export async function cleanBuild(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    await folderCleanBuild(current);
}

/**
 * Run `swift package clean` inside a folder
 * @param folderContext folder to run update inside
 */
export async function folderCleanBuild(folderContext: FolderContext) {
    const task = createSwiftTask(
        ["package", "clean"],
        SwiftTaskProvider.cleanBuildName,
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            prefix: folderContext.name,
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
            group: vscode.TaskGroup.Clean,
        },
        folderContext.workspaceContext.toolchain
    );

    await executeTaskWithUI(task, "Clean Build", folderContext);
}

/**
 * Executes a {@link vscode.Task task} to reset the complete cache/build directory.
 */
export async function resetPackage(ctx: WorkspaceContext) {
    const current = ctx.currentFolder;
    if (!current) {
        return;
    }
    await folderResetPackage(current);
}

/**
 * Run `swift package reset` inside a folder
 * @param folderContext folder to run update inside
 */
export async function folderResetPackage(folderContext: FolderContext) {
    const task = createSwiftTask(
        ["package", "reset"],
        "Reset Package Dependencies",
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            prefix: folderContext.name,
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
            group: vscode.TaskGroup.Clean,
        },
        folderContext.workspaceContext.toolchain
    );

    await executeTaskWithUI(task, "Reset Package", folderContext).then(async success => {
        if (!success) {
            return;
        }
        const resolveTask = createSwiftTask(
            ["package", "resolve"],
            SwiftTaskProvider.resolvePackageName,
            {
                cwd: folderContext.folder,
                scope: folderContext.workspaceFolder,
                prefix: folderContext.name,
                presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
            },
            folderContext.workspaceContext.toolchain
        );

        await executeTaskWithUI(resolveTask, "Resolving Dependencies", folderContext);
    });
}

/**
 * Run single Swift file through Swift REPL
 */
async function runSwiftScript(ctx: WorkspaceContext) {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
        return;
    }

    // Swift scripts require new swift driver to work on Windows. Swift driver is available
    // from v5.7 of Windows Swift
    if (
        process.platform === "win32" &&
        ctx.toolchain.swiftVersion.isLessThan(new Version(5, 7, 0))
    ) {
        vscode.window.showErrorMessage(
            "Run Swift Script is unavailable with the legacy driver on Windows."
        );
        return;
    }

    let filename = document.fileName;
    let isTempFile = false;
    if (document.isUntitled) {
        // if document hasn't been saved, save it to a temporary file
        isTempFile = true;
        filename = ctx.tempFolder.filename(document.fileName, "swift");
        const text = document.getText();
        await fs.writeFile(filename, text);
    } else {
        // otherwise save document
        await document.save();
    }

    const runTask = createSwiftTask(
        [filename],
        `Run ${filename}`,
        {
            scope: vscode.TaskScope.Global,
            cwd: vscode.Uri.file(path.dirname(filename)),
            presentationOptions: { reveal: vscode.TaskRevealKind.Always, clear: true },
        },
        ctx.toolchain
    );
    await ctx.tasks.executeTaskAndWait(runTask);

    // delete file after running swift
    if (isTempFile) {
        await fs.rm(filename);
    }
}

async function runPluginTask() {
    vscode.commands.executeCommand("workbench.action.tasks.runTask", {
        type: "swift-plugin",
    });
}

/**
 * Use local version of package dependency
 *
 * equivalent of `swift package edit --path <localpath> identifier
 * @param identifier Identifier for dependency
 * @param ctx workspace context
 */
async function useLocalDependency(identifier: string, ctx: WorkspaceContext) {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        return;
    }
    vscode.window
        .showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: currentFolder.folder,
            openLabel: "Select",
            title: "Select folder",
        })
        .then(async value => {
            if (!value) {
                return;
            }
            const folder = value[0];
            const task = createSwiftTask(
                ["package", "edit", "--path", folder.fsPath, identifier],
                "Edit Package Dependency",
                {
                    scope: currentFolder.workspaceFolder,
                    cwd: currentFolder.folder,
                    prefix: currentFolder.name,
                },
                ctx.toolchain
            );
            await executeTaskWithUI(
                task,
                `Use local version of ${identifier}`,
                currentFolder,
                true
            ).then(result => {
                if (result) {
                    ctx.fireEvent(currentFolder, FolderEvent.resolvedUpdated);
                }
            });
        });
}

/**
 * Setup package dependency to be edited
 * @param identifier Identifier of dependency we want to edit
 * @param ctx workspace context
 */
async function editDependency(identifier: string, ctx: WorkspaceContext) {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        return;
    }
    const task = createSwiftTask(
        ["package", "edit", identifier],
        "Edit Package Dependency",
        {
            scope: currentFolder.workspaceFolder,
            cwd: currentFolder.folder,
            prefix: currentFolder.name,
        },
        ctx.toolchain
    );
    await executeTaskWithUI(task, `edit locally ${identifier}`, currentFolder, true).then(
        result => {
            if (result) {
                ctx.fireEvent(currentFolder, FolderEvent.resolvedUpdated);
                // add folder to workspace
                const index = vscode.workspace.workspaceFolders?.length ?? 0;
                vscode.workspace.updateWorkspaceFolders(index, 0, {
                    uri: vscode.Uri.file(currentFolder.editedPackageFolder(identifier)),
                    name: identifier,
                });
            }
        }
    );
}

/**
 * Stop local editing of package dependency
 * @param identifier Identifier of dependency
 * @param ctx workspace context
 */
async function uneditDependency(identifier: string, ctx: WorkspaceContext) {
    const currentFolder = ctx.currentFolder;
    if (!currentFolder) {
        return;
    }
    ctx.outputChannel.log(`unedit dependency ${identifier}`, currentFolder.name);
    const status = `Reverting edited dependency ${identifier} (${currentFolder.name})`;
    ctx.statusItem.showStatusWhileRunning(status, async () => {
        await uneditFolderDependency(currentFolder, identifier, ctx);
    });
}

async function uneditFolderDependency(
    folder: FolderContext,
    identifier: string,
    ctx: WorkspaceContext,
    args: string[] = []
) {
    try {
        const uneditOperation = new SwiftExecOperation(
            ["package", "unedit", ...args, identifier],
            folder,
            `Finish editing ${identifier}`,
            { showStatusItem: true, checkAlreadyRunning: false, log: "Unedit" },
            () => {
                // do nothing. Just want to run the process on the Task queue to ensure it
                // doesn't clash with another swifr process
            }
        );
        await folder.taskQueue.queueOperation(uneditOperation);

        ctx.fireEvent(folder, FolderEvent.resolvedUpdated);
        // find workspace folder, and check folder still exists
        const folderIndex = vscode.workspace.workspaceFolders?.findIndex(
            item => item.name === identifier
        );
        if (folderIndex) {
            try {
                // check folder exists. if error thrown remove folder
                await fs.stat(vscode.workspace.workspaceFolders![folderIndex].uri.fsPath);
            } catch {
                vscode.workspace.updateWorkspaceFolders(folderIndex, 1);
            }
        }
    } catch (error) {
        const execError = error as { stderr: string };
        // if error contains "has uncommited changes" then ask if user wants to force the unedit
        if (execError.stderr.match(/has uncommited changes/)) {
            vscode.window
                .showWarningMessage(
                    `${identifier} has uncommitted changes. Are you sure you want to continue?`,
                    "Yes",
                    "No"
                )
                .then(async result => {
                    if (result === "No") {
                        ctx.outputChannel.log(execError.stderr, folder.name);
                        return;
                    }
                    await uneditFolderDependency(folder, identifier, ctx, ["--force"]);
                });
        } else {
            ctx.outputChannel.log(execError.stderr, folder.name);
            vscode.window.showErrorMessage(`${execError.stderr}`);
        }
    }
}

/**
 * Open local package in workspace
 * @param packageNode PackageNode attached to dependency tree item
 */
async function openInWorkspace(packageNode: PackageNode) {
    const index = vscode.workspace.workspaceFolders?.length ?? 0;
    vscode.workspace.updateWorkspaceFolders(index, 0, {
        uri: vscode.Uri.file(packageNode.path),
        name: packageNode.name,
    });
}

/**
 * Open Package.swift for in focus project
 * @param workspaceContext Workspace context, required to get current project
 */
async function openPackage(workspaceContext: WorkspaceContext) {
    if (workspaceContext.currentFolder) {
        const packagePath = vscode.Uri.joinPath(
            workspaceContext.currentFolder.folder,
            "Package.swift"
        );
        const document = await vscode.workspace.openTextDocument(packagePath);
        vscode.window.showTextDocument(document);
    }
}

async function insertFunctionComment(workspaceContext: WorkspaceContext): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }
    const line = activeEditor.selection.active.line;
    workspaceContext.commentCompletionProvider.insert(activeEditor, line);
}

/** Restart the SourceKit-LSP server */
function restartLSPServer(workspaceContext: WorkspaceContext): Promise<void> {
    return workspaceContext.languageClientManager.restart();
}

/** Request that the SourceKit-LSP server reindexes the workspace */
function reindexProject(workspaceContext: WorkspaceContext): Promise<unknown> {
    return workspaceContext.languageClientManager.useLanguageClient(async (client, token) => {
        try {
            await client.sendRequest(reindexProjectRequest, {}, token);
            const result = await vscode.window.showWarningMessage(
                "Re-indexing a project should never be necessary and indicates a bug in SourceKit-LSP. Please file an issue describing which symbol was out-of-date and how you got into the state.",
                "Report Issue",
                "Close"
            );
            if (result === "Report Issue") {
                vscode.commands.executeCommand(
                    "vscode.open",
                    vscode.Uri.parse(
                        "https://github.com/swiftlang/sourcekit-lsp/issues/new?template=BUG_REPORT.yml&title=Symbol%20Indexing%20Issue"
                    )
                );
            }
        } catch (err) {
            const error = err as { code: number; message: string };
            // methodNotFound, version of sourcekit-lsp is likely too old.
            if (error.code === -32601) {
                vscode.window.showWarningMessage(
                    "The installed version of SourceKit-LSP does not support background indexing."
                );
            } else {
                vscode.window.showWarningMessage(error.message);
            }
        }
    });
}

/** Execute task and show UI while running */
async function executeTaskWithUI(
    task: vscode.Task,
    description: string,
    folderContext: FolderContext,
    showErrors = false,
    checkAlreadyRunning?: boolean
): Promise<boolean> {
    try {
        const exitCode = await folderContext.taskQueue.queueOperation(
            new TaskOperation(task, {
                showStatusItem: true,
                checkAlreadyRunning: checkAlreadyRunning ?? false,
                log: description,
            })
        );
        if (exitCode === 0) {
            return true;
        } else {
            if (showErrors) {
                vscode.window.showErrorMessage(`${description} failed`);
            }
            return false;
        }
    } catch (error) {
        if (showErrors) {
            vscode.window.showErrorMessage(`${description} failed: ${error}`);
        }
        return false;
    }
}

/**
 *
 * @param packageNode PackageNode attached to dependency tree item
 */
function openInExternalEditor(packageNode: PackageNode) {
    try {
        const uri = vscode.Uri.parse(packageNode.location, true);
        vscode.env.openExternal(uri);
    } catch {
        // ignore error
    }
}

/**
 * Switches the target SDK to the platform selected in a QuickPick UI.
 */
async function switchPlatform() {
    await withQuickPick(
        "Select a new target",
        [
            { value: undefined, label: "macOS" },
            { value: DarwinCompatibleTarget.iOS, label: "iOS" },
            { value: DarwinCompatibleTarget.tvOS, label: "tvOS" },
            { value: DarwinCompatibleTarget.watchOS, label: "watchOS" },
            { value: DarwinCompatibleTarget.visionOS, label: "visionOS" },
        ],
        async picked => {
            try {
                const sdkForTarget = picked.value
                    ? await SwiftToolchain.getSDKForTarget(picked.value)
                    : "";
                if (sdkForTarget !== undefined) {
                    if (sdkForTarget !== "") {
                        configuration.sdk = sdkForTarget;
                        vscode.window.showWarningMessage(
                            `Selecting the ${picked.label} SDK will provide code editing support, but compiling with this SDK will have undefined results.`
                        );
                    } else {
                        configuration.sdk = undefined;
                    }
                } else {
                    vscode.window.showErrorMessage("Unable to obtain requested SDK path");
                }
            } catch {
                vscode.window.showErrorMessage("Unable to obtain requested SDK path");
            }
        }
    );
}

async function attachDebugger(ctx: WorkspaceContext) {
    // use LLDB to get list of processes
    const lldb = await ctx.toolchain.getLLDB();
    try {
        const { stdout } = await execFile(lldb, [
            "--batch",
            "--no-lldbinit",
            "--one-line",
            "platform process list --show-args --all-users",
        ]);
        const entries = stdout.split("\n");
        const processPickItems = entries.flatMap(line => {
            const match = /^(\d+)\s+\d+\s+\S+\s+\S+\s+(.+)$/.exec(line);
            if (match) {
                return [{ pid: parseInt(match[1]), label: `${match[1]}: ${match[2]}` }];
            } else {
                return [];
            }
        });
        await withQuickPick("Select Process", processPickItems, async selected => {
            const debugConfig: vscode.DebugConfiguration = {
                type: "swift-lldb",
                request: "attach",
                name: "Attach",
                pid: selected.pid,
            };
            await vscode.debug.startDebugging(undefined, debugConfig);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to run LLDB: ${getErrorDescription(error)}`);
    }
}

function updateAfterError(result: boolean, folderContext: FolderContext) {
    const triggerResolvedUpdatedEvent = folderContext.hasResolveErrors;
    // set has resolve errors flag
    folderContext.hasResolveErrors = !result;
    // if previous folder state was with resolve errors, and now it is without then
    // send Package.resolved updated event to trigger display of package dependencies
    // view
    if (triggerResolvedUpdatedEvent && !folderContext.hasResolveErrors) {
        folderContext.fireEvent(FolderEvent.resolvedUpdated);
    }
}

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
        vscode.commands.registerCommand("swift.resolveDependencies", () =>
            resolveDependencies(ctx)
        ),
        vscode.commands.registerCommand("swift.updateDependencies", () => updateDependencies(ctx)),
        vscode.commands.registerCommand("swift.run", () => runBuild(ctx)),
        vscode.commands.registerCommand("swift.debug", () => debugBuild(ctx)),
        vscode.commands.registerCommand("swift.cleanBuild", () => cleanBuild(ctx)),
        // Note: This is only available on macOS (gated in `package.json`) because its the only OS that has the iOS SDK available.
        vscode.commands.registerCommand("swift.switchPlatform", () => switchPlatform()),
        vscode.commands.registerCommand("swift.resetPackage", () => resetPackage(ctx)),
        vscode.commands.registerCommand("swift.runScript", () => runSwiftScript(ctx)),
        vscode.commands.registerCommand("swift.openPackage", () => openPackage(ctx)),
        vscode.commands.registerCommand("swift.runSnippet", () => runSnippet(ctx)),
        vscode.commands.registerCommand("swift.debugSnippet", () => debugSnippet(ctx)),
        vscode.commands.registerCommand("swift.runPluginTask", () => runPluginTask()),
        vscode.commands.registerCommand("swift.restartLSPServer", () => restartLSPServer(ctx)),
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
