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
import * as path from "path";
import * as vscode from "vscode";
import { tmpdir } from "os";
import { exec } from "child_process";
import { Writable } from "stream";
import { WorkspaceContext } from "../WorkspaceContext";
import { Version } from "../utilities/version";
import { execFileStreamOutput } from "../utilities/utilities";
import configuration from "../configuration";

export async function captureDiagnostics(
    ctx: WorkspaceContext,
    allowMinimalCapture: boolean = true
) {
    try {
        const captureMode = await captureDiagnosticsMode(ctx, allowMinimalCapture);

        // dialog was cancelled
        if (!captureMode) {
            return;
        }

        const diagnosticsDir = path.join(
            tmpdir(),
            `vscode-diagnostics-${formatDateString(new Date())}`
        );

        await fs.mkdir(diagnosticsDir);
        await writeLogFile(diagnosticsDir, "extension-logs.txt", extensionLogs(ctx));
        await writeLogFile(diagnosticsDir, "settings.txt", settingsLogs(ctx));

        if (captureMode === "Full") {
            await writeLogFile(diagnosticsDir, "source-code-diagnostics.txt", diagnosticLogs());

            // The `sourcekit-lsp diagnose` command is only available in 6.0 and higher.
            if (ctx.swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0))) {
                await sourcekitDiagnose(ctx, diagnosticsDir);
            } else {
                await writeLogFile(diagnosticsDir, "sourcekit-lsp.txt", sourceKitLogs(ctx));
            }
        }

        ctx.outputChannel.log(`Saved diagnostics to ${diagnosticsDir}`);
        await showCapturedDiagnosticsResults(diagnosticsDir);
    } catch (error) {
        vscode.window.showErrorMessage(`Unable to capture diagnostic logs: ${error}`);
    }
}

export async function promptForDiagnostics(ctx: WorkspaceContext) {
    const ok = "OK";
    const cancel = "Cancel";
    const result = await vscode.window.showInformationMessage(
        "SourceKit-LSP has been restored. Would you like to capture a diagnostic bundle to file an issue?",
        ok,
        cancel
    );

    if (!result || result === cancel) {
        return;
    }

    return await captureDiagnostics(ctx, false);
}

async function captureDiagnosticsMode(
    ctx: WorkspaceContext,
    allowMinimalCapture: boolean
): Promise<"Minimal" | "Full" | undefined> {
    if (
        ctx.swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0)) ||
        vscode.workspace.getConfiguration("sourcekit-lsp").get<string>("trace.server", "off") !==
            "off"
    ) {
        const fullButton = allowMinimalCapture ? "Capture Full Diagnostics" : "Capture Diagnostics";
        const minimalButton = "Capture Minimal Diagnostics";
        const buttons = allowMinimalCapture ? [fullButton, minimalButton] : [fullButton];
        const fullCaptureResult = await vscode.window.showInformationMessage(
            `A Diagnostic Bundle collects information that helps the developers of the Swift for VS Code extension diagnose and fix issues.

This information contains:
- Extension logs
- Versions of Swift installed on your system
- Crash logs from SourceKit
- Log messages emitted by SourceKit
- If possible, a minimized project that caused SourceKit to crash
- If possible, a minimized project that caused the Swift compiler to crash

All information is collected locally and you can inspect the diagnose bundle before sharing it with developers of the Swift for VS Code extension.

Please file an issue with a description of the problem you are seeing at https://github.com/swiftlang/vscode-swift, and attach this diagnose bundle.`,
            {
                modal: true,
                detail: allowMinimalCapture
                    ? `If you wish to omit potentially sensitive information choose "${minimalButton}"`
                    : undefined,
            },
            ...buttons
        );
        if (!fullCaptureResult) {
            return undefined;
        }

        return fullCaptureResult === fullButton ? "Full" : "Minimal";
    } else {
        return "Minimal";
    }
}

async function showCapturedDiagnosticsResults(diagnosticsDir: string) {
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

function settingsLogs(ctx: WorkspaceContext): string {
    const settings = JSON.stringify(vscode.workspace.getConfiguration("swift"), null, 2);
    return `${ctx.toolchain.diagnostics}\nSettings:\n${settings}`;
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
            progress.report({ message: "Diagnosing SourceKit-LSP..." });
            const writableStream = progressUpdatingWritable(percent =>
                progress.report({ message: `Diagnosing SourceKit-LSP: ${percent}%` })
            );

            await execFileStreamOutput(
                serverPath,
                [
                    "diagnose",
                    "--bundle-output-path",
                    sourcekitDiagnosticDir,
                    "--toolchain",
                    ctx.toolchain.toolchainPath,
                ],
                writableStream,
                writableStream,
                null,
                {
                    env: { ...process.env, ...configuration.swiftEnvironmentVariables },
                    maxBuffer: 16 * 1024 * 1024,
                },
                ctx.currentFolder ?? undefined
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
