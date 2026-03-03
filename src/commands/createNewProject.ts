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
import * as fs from "fs/promises";
import * as vscode from "vscode";

import configuration from "../configuration";
import { SwiftProjectTemplate, SwiftToolchain } from "../toolchain/toolchain";
import { showToolchainError } from "../ui/ToolchainSelection";
import { withDelayedProgress } from "../ui/withDelayedProgress";
import { execSwift } from "../utilities/utilities";

function validateProjectName(value: string, existingNames: string[]): string | undefined {
    if (value.trim() === "") {
        return "Project name cannot be empty.";
    }
    if (value.includes("/") || value.includes("\\")) {
        return "Project name cannot contain '/' or '\\' characters.";
    }
    if (value === "." || value === "..") {
        return "Project name cannot be '.' or '..'.";
    }
    if (existingNames.includes(value)) {
        return "A file/folder with this name already exists.";
    }
    return undefined;
}

function determineOpenAction(
    openAfterCreate: string,
    isWorkspaceOpened: boolean
): "open" | "openNewWindow" | "addToWorkspace" | undefined {
    if (openAfterCreate === "always") {
        return "open";
    }
    if (openAfterCreate === "alwaysNewWindow") {
        return "openNewWindow";
    }
    if (openAfterCreate === "whenNoFolderOpen" && !isWorkspaceOpened) {
        return "open";
    }
    return undefined;
}

async function promptForOpenAction(
    projectName: string,
    isWorkspaceOpened: boolean
): Promise<"open" | "openNewWindow" | "addToWorkspace" | undefined> {
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
    const actionMap: Record<string, "open" | "openNewWindow" | "addToWorkspace"> = {
        [open]: "open",
        [openNewWindow]: "openNewWindow",
        [addToWorkspace]: "addToWorkspace",
    };
    return result ? actionMap[result] : undefined;
}

async function executeOpenAction(
    action: "open" | "openNewWindow" | "addToWorkspace",
    projectUri: vscode.Uri
): Promise<void> {
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
        vscode.workspace.updateWorkspaceFolders(index, 0, { uri: projectUri });
    }
}

/**
 * Prompts the user to input project details and then executes `swift package init`
 * to create the project.
 */
export async function createNewProject(
    extensionPath: string,
    toolchain: SwiftToolchain | undefined
): Promise<void> {
    // It is possible for this command to be run without a valid toolchain because it can be
    // run before the Swift extension is activated. Show the toolchain error notification in
    // this case.
    if (!toolchain) {
        void showToolchainError(extensionPath);
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
        validateInput: value => validateProjectName(value, existingNames),
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
    const action =
        determineOpenAction(configuration.openAfterCreateNewProject, isWorkspaceOpened) ??
        (await promptForOpenAction(projectName, isWorkspaceOpened));

    if (action) {
        await executeOpenAction(action, projectUri);
    }
}
