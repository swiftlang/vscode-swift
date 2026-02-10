//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as vscode from "vscode";

import { FolderContext } from "../../FolderContext";
import { PackageContents, SwiftPackage } from "../../SwiftPackage";
import { SwiftTaskProvider, createSwiftTask } from "../../tasks/SwiftTaskProvider";
import { packageName } from "../../utilities/tasks";
import { executeTaskWithUI, updateAfterError } from "../utilities";

/**
 * Configuration for executing a Swift package command
 */
interface SwiftPackageCommandConfig {
    /** The Swift command arguments (e.g., ["package", "show-dependencies", "--format", "json"]) */
    args: string[];
    /** The task name for the SwiftTaskProvider */
    taskName: string;
    /** The UI message to display during execution */
    uiMessage: string;
    /** The command name for error messages */
    commandName: string;
}

/**
 * Execute a Swift package command and return the parsed JSON output
 * @param folderContext folder to run the command in
 * @param config command configuration
 * @returns parsed JSON output from the command
 */
export async function executeSwiftPackageCommand<T>(
    folderContext: FolderContext,
    config: SwiftPackageCommandConfig,
    token?: vscode.CancellationToken
): Promise<T> {
    const task = createSwiftTask(
        config.args,
        config.taskName,
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            packageName: packageName(folderContext),
            presentationOptions: { reveal: vscode.TaskRevealKind.Silent },
            dontTriggerTestDiscovery: true,
            group: vscode.TaskGroup.Build,
        },
        folderContext.toolchain,
        undefined,
        { readOnlyTerminal: true }
    );

    const outputChunks: string[] = [];
    task.execution.onDidWrite((data: string) => {
        outputChunks.push(data);
    });

    const success = await executeTaskWithUI(
        task,
        config.uiMessage,
        folderContext,
        false,
        false,
        token
    );
    updateAfterError(success, folderContext);

    const output = outputChunks.join("");

    if (!success) {
        throw new Error(output);
    }

    if (!output.trim()) {
        throw new Error(`No output received from swift ${config.commandName} command`);
    }

    try {
        const trimmedOutput = SwiftPackage.trimStdout(output);
        const parsedOutput = JSON.parse(trimmedOutput);

        // Validate the parsed output is an object
        if (!parsedOutput || typeof parsedOutput !== "object") {
            throw new Error(`Invalid format received from swift ${config.commandName} command`);
        }

        return parsedOutput as T;
    } catch (parseError) {
        throw new Error(
            `Failed to parse ${config.commandName} output: ${parseError instanceof Error ? parseError.message : "Unknown error"}`
        );
    }
}

/**
 * Run `swift package describe` inside a folder
 * @param folderContext folder to run describe for
 */
export async function describePackage(
    folderContext: FolderContext,
    token?: vscode.CancellationToken
): Promise<PackageContents> {
    const result = await executeSwiftPackageCommand<PackageContents>(
        folderContext,
        {
            args: ["package", "describe", "--type", "json"],
            taskName: SwiftTaskProvider.describePackageName,
            uiMessage: "Describing Package",
            commandName: "package describe",
        },
        token
    );

    return result;
}
