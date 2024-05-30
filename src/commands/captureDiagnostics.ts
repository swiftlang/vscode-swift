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
import { SwiftOutputChannel } from "../ui/SwiftOutputChannel";
import { WorkspaceContext } from "../WorkspaceContext";

export async function captureDiagnostics(ctx: WorkspaceContext) {
    const diagnosticsDir = path.join(
        tmpdir(),
        `vscode-diagnostics-${formatDateString(new Date())}`
    );

    const versionOutputChannel = new SwiftOutputChannel();
    ctx.toolchain.logDiagnostics(versionOutputChannel);

    const logs = ctx.outputChannel.logs.join("\n");
    const versionLogs = versionOutputChannel.logs.join("\n");
    const diagnosticLogs = buildDiagnostics();

    try {
        await fs.mkdir(diagnosticsDir);
        await fs.writeFile(path.join(diagnosticsDir, "logs.txt"), logs);
        await fs.writeFile(path.join(diagnosticsDir, "version.txt"), versionLogs);
        await fs.writeFile(path.join(diagnosticsDir, "diagnostics.txt"), diagnosticLogs);

        ctx.outputChannel.log(`Saved diagnostics to ${diagnosticsDir}`);

        const showInFinderButton = "Show In Finder";
        const copyPath = "Copy Path to Clipboard";
        const infoDialogButtons = [
            ...(process.platform === "darwin" ? [showInFinderButton] : []),
            copyPath,
        ];
        const result = await vscode.window.showInformationMessage(
            `Saved diagnostic logs to ${diagnosticsDir}`,
            ...infoDialogButtons
        );
        if (result === copyPath) {
            vscode.env.clipboard.writeText(diagnosticsDir);
        } else if (result === showInFinderButton) {
            exec(`open ${diagnosticsDir}`, error => {
                if (error) {
                    vscode.window.showErrorMessage(`Failed to open Finder: ${error.message}`);
                    return;
                }
            });
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Unable to captrure diagnostics logs: ${error}`);
    }
}

function buildDiagnostics(): string {
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

function padZero(num: number, length: number = 2): string {
    return num.toString().padStart(length, "0");
}

function formatDateString(date: Date): string {
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
