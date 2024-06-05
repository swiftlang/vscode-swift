//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { tmpdir } from "os";
import { exec } from "child_process";
import { Writable } from "stream";
import { SwiftOutputChannel } from "../ui/SwiftOutputChannel";
import { WorkspaceContext } from "../WorkspaceContext";
import { Version } from "../utilities/version";
import { execFileStreamOutput } from "../utilities/utilities";
import configuration from "../configuration";

export async function captureDiagnostics(ctx: WorkspaceContext) {
    const diagnosticsDir = path.join(
        tmpdir(),
        `vscode-diagnostics-${formatDateString(new Date())}`
    );

    try {
        await fs.mkdir(diagnosticsDir);
        await writeLogFile(diagnosticsDir, "logs.txt", extensionLogs(ctx));
        await writeLogFile(diagnosticsDir, "environment.txt", environmentLogs(ctx));

        if (ctx.swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0))) {
            // sourcekit-lsp diagnose command is only available in 6.0 and higher.
            // await writeLogFile(diagnosticsDir, "sourcekit-lsp.txt", );
            await sourcekitDiagnose(ctx, diagnosticsDir);
        } else {
            await writeLogFile(diagnosticsDir, "sourcekit-lsp.txt", sourceKitLogs(ctx));
        }

        await writeLogFile(diagnosticsDir, "diagnostics.txt", diagnosticLogs());

        ctx.outputChannel.log(`Saved diagnostics to ${diagnosticsDir}`);

        const showInFinderButton = `Show In ${showCommandType()}`;
        const copyPath = "Copy Path to Clipboard";
        const result = await vscode.window.showInformationMessage(
            `Saved diagnostic logs to ${diagnosticsDir}`,
            showInFinderButton,
            copyPath
        );
        if (result === copyPath) {
            vscode.env.clipboard.writeText(diagnosticsDir);
        } else if (result === showInFinderButton) {
            exec(showDirectoryCommand(diagnosticsDir), error => {
                // Opening the explorer on windows returns an exit code of 1 despite opening successfully.
                if (error && process.platform !== "win32") {
                    vscode.window.showErrorMessage(
                        `Failed to open ${showCommandType()}: ${error.message}`
                    );
                }
            });
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Unable to capture diagnostic logs: ${error}`);
    }
}

async function writeLogFile(dir: string, name: string, logs: string) {
    if (logs.length === 0) {
        return;
    }
    await fs.writeFile(path.join(dir, name), logs);
}

function extensionLogs(ctx: WorkspaceContext): string {
    return ctx.outputChannel.logs.join("\n");
}

function environmentLogs(ctx: WorkspaceContext): string {
    const environmentOutputChannel = new SwiftOutputChannel("Swift", false);
    ctx.toolchain.logDiagnostics(environmentOutputChannel);
    environmentOutputChannel.log("Extension Settings:");
    environmentOutputChannel.log(
        JSON.stringify(vscode.workspace.getConfiguration("swift"), null, 2)
    );
    return environmentOutputChannel.logs.join("\n");
}

function diagnosticLogs(): string {
    const diagnosticToString = (diagnostic: vscode.Diagnostic) => {
        return `${severityToString(diagnostic.severity)} - ${diagnostic.message} [Ln ${diagnostic.range.start.line}, Col ${diagnostic.range.start.character}]`;
    };

    return vscode.languages
        .getDiagnostics()
        .map(
            ([uri, diagnostics]) => `${uri}\n\t${diagnostics.map(diagnosticToString).join("\n\t")}`
        )
        .join("\n");
}

function sourceKitLogs(ctx: WorkspaceContext) {
    return (ctx.languageClientManager.languageClientOutputChannel?.logs ?? []).join("\n");
}

async function sourcekitDiagnose(ctx: WorkspaceContext, dir: string) {
    const sourcekitDiagnosticDir = path.join(dir, "sourcekit-lsp");
    await fs.mkdir(sourcekitDiagnosticDir);

    const toolchainSourceKitLSP = ctx.toolchain.getToolchainExecutable("sourcekit-lsp");
    const lspConfig = configuration.lsp;
    const serverPathConfig = lspConfig.serverPath;
    const serverPath = serverPathConfig.length > 0 ? serverPathConfig : toolchainSourceKitLSP;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
        },
        async progress => {
            progress.report({ message: "Capturing Diagnostics..." });
            const writableStream = progressUpdatingWritable(percent =>
                progress.report({ message: `Capturing Diagnostics: ${percent}%` })
            );

            await execFileStreamOutput(
                serverPath,
                ["diagnose", "--bundle-output-path", sourcekitDiagnosticDir],
                writableStream,
                writableStream,
                null,
                {
                    env: { ...process.env, ...configuration.swiftEnvironmentVariables },
                    maxBuffer: 16 * 1024 * 1024,
                }
            );
        }
    );
}

function progressUpdatingWritable(updateProgress: (str: string) => void): Writable {
    return new Writable({
        write(chunk, encoding, callback) {
            const str = (chunk as Buffer).toString("utf8").trim();
            const percent = /^([0-9])+%/.exec(str);
            if (percent && percent[1]) {
                updateProgress(percent[1]);
            }

            callback();
        },
    });
}

function showDirectoryCommand(dir: string): string {
    switch (process.platform) {
        case "win32":
            return `explorer ${dir}`;
        case "darwin":
            return `open ${dir}`;
        default:
            return `xdg-open ${dir}`;
    }
}

function showCommandType(): string {
    switch (process.platform) {
        case "win32":
            return "Explorer";
        case "darwin":
            return "Finder";
        default:
            return "File Manager";
    }
}

function severityToString(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
        case vscode.DiagnosticSeverity.Error:
            return "Error";
        case vscode.DiagnosticSeverity.Warning:
            return "Warning";
        case vscode.DiagnosticSeverity.Information:
            return "Information";
        case vscode.DiagnosticSeverity.Hint:
            return "Hint";
    }
}

function formatDateString(date: Date): string {
    const padZero = (num: number, length: number = 2) => num.toString().padStart(length, "0");

    const year = date.getFullYear();
    const month = padZero(date.getMonth() + 1);
    const day = padZero(date.getDate());
    const hours = padZero(date.getHours());
    const minutes = padZero(date.getMinutes());
    const seconds = padZero(date.getSeconds());
    const timezoneOffset = -date.getTimezoneOffset();
    const timezoneSign = timezoneOffset >= 0 ? "+" : "-";
    const timezoneHours = padZero(Math.floor(Math.abs(timezoneOffset) / 60));
    const timezoneMinutes = padZero(Math.abs(timezoneOffset) % 60);
    return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}${timezoneSign}${timezoneHours}-${timezoneMinutes}`;
}
