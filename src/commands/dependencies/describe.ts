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
import { PackageContents } from "../../SwiftPackage";
import configuration from "../../configuration";
import { ReadOnlySwiftProcess } from "../../tasks/SwiftProcess";
import { SwiftTaskProvider, createSwiftTask } from "../../tasks/SwiftTaskProvider";
import { packageName } from "../../utilities/tasks";
import { swiftRuntimeEnv } from "../../utilities/utilities";
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
    const args = folderContext.toolchain.buildFlags.withAdditionalFlags(config.args);
    const inv = folderContext.toolchain.getToolchainInvocation("swift", args);

    const swiftProcess = new ReadOnlySwiftProcess(inv.command, inv.args, {
        cwd: folderContext.folder.fsPath,
        env: {
            ...swiftRuntimeEnv(),
            ...configuration.swiftEnvironmentVariables,
        },
    });

    const logger = folderContext.workspaceContext.logger;
    const debugTag = `[stream-debug:${config.commandName}:${folderContext.name}]`;
    const startedAt = Date.now();
    const elapsed = () => `${Date.now() - startedAt}ms`;

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let firstStdoutAt: number | undefined;
    let firstStderrAt: number | undefined;
    const stdoutDisposable = swiftProcess.onDidWriteStdout(data => {
        if (firstStdoutAt === undefined) {
            firstStdoutAt = Date.now() - startedAt;
            logger.info(
                `${debugTag} first stdout chunk @ ${firstStdoutAt}ms (${data.length} chars, head=${JSON.stringify(data.slice(0, 64))})`
            );
        }
        stdoutChunks.push(data);
    });
    const stderrDisposable = swiftProcess.onDidWriteStderr(data => {
        if (firstStderrAt === undefined) {
            firstStderrAt = Date.now() - startedAt;
            logger.info(
                `${debugTag} first stderr chunk @ ${firstStderrAt}ms (${data.length} chars, head=${JSON.stringify(data.slice(0, 64))})`
            );
        }
        stderrChunks.push(data);
    });
    logger.info(
        `${debugTag} starting; cmd=${inv.command} args=${JSON.stringify(inv.args)} cwd=${folderContext.folder.fsPath}`
    );

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
        { readOnlyTerminal: true },
        swiftProcess
    );

    try {
        const success = await executeTaskWithUI(
            task,
            config.uiMessage,
            folderContext,
            false,
            false,
            token
        );
        updateAfterError(success, folderContext);

        const stdout = stdoutChunks.join("");
        const stderr = stderrChunks.join("");

        // Hex dump the first 32 bytes of stdout to detect a BOM or non-printable
        // prefix that would silently break JSON.parse without showing in a string log.
        const stdoutHead = Buffer.from(stdout.slice(0, 32), "utf8").toString("hex");
        const firstBraceAt = stdout.indexOf("{");
        logger.info(
            `${debugTag} task done @ ${elapsed()} success=${success} stdoutChunks=${stdoutChunks.length} (${stdout.length} chars) stderrChunks=${stderrChunks.length} (${stderr.length} chars) firstBraceAt=${firstBraceAt} stdoutHeadHex=${stdoutHead}`
        );
        logger.info(`${debugTag} STDOUT >>>>>\n${stdout}\n<<<<< STDOUT`);
        logger.info(`${debugTag} STDERR >>>>>\n${stderr}\n<<<<< STDERR`);

        if (!success) {
            throw new Error(stderr || stdout);
        }

        if (!stdout.trim()) {
            throw new Error(`No output received from swift ${config.commandName} command`);
        }

        let parsedOutput: unknown;
        try {
            parsedOutput = JSON.parse(stdout);
        } catch (err) {
            logger.error(
                `${debugTag} JSON.parse FAILED @ ${elapsed()}: ${err}. firstBraceAt=${firstBraceAt}, treating non-JSON prefix as a probable cause`
            );
            throw err;
        }

        if (!parsedOutput || typeof parsedOutput !== "object") {
            throw new Error(`Invalid format received from swift ${config.commandName} command`);
        }

        logger.info(`${debugTag} parsed successfully @ ${elapsed()}`);
        return parsedOutput as T;
    } catch (parseError) {
        logger.error(`${debugTag} executeSwiftPackageCommand failed @ ${elapsed()}: ${parseError}`);
        throw new Error(`Failed to parse ${config.commandName} output`, { cause: parseError });
    } finally {
        stdoutDisposable.dispose();
        stderrDisposable.dispose();
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
