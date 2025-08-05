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

import * as archiver from "archiver";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { tmpdir } from "os";
import { exec } from "child_process";
import { Writable } from "stream";
import { WorkspaceContext } from "../WorkspaceContext";
import { Version } from "../utilities/version";
import { destructuredPromise, execFileStreamOutput } from "../utilities/utilities";
import configuration from "../configuration";
import { FolderContext } from "../FolderContext";
import { Extension } from "../utilities/extensions";

export async function captureDiagnostics(
    ctx: WorkspaceContext,
    allowMinimalCapture: boolean = true
): Promise<string | undefined> {
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

        await fsPromises.mkdir(diagnosticsDir);

        const singleFolderWorkspace = ctx.folders.length === 1;
        const zipDir = await createDiagnosticsZipDir();
        const zipFilePath = path.join(zipDir, `${path.basename(diagnosticsDir)}.zip`);
        const { archive, done: archivingDone } = configureZipArchiver(zipFilePath);

        const archivedLldbDapLogFolders = new Set<string>();
        if (captureMode === "Full") {
            for (const defaultLldbDapLogs of [defaultLldbDapLogFolder(ctx), lldbDapLogFolder()]) {
                if (!defaultLldbDapLogs || archivedLldbDapLogFolders.has(defaultLldbDapLogs)) {
                    continue;
                }
                archivedLldbDapLogFolders.add(defaultLldbDapLogs);
                await copyLogFolder(ctx, diagnosticsDir, defaultLldbDapLogs);
            }
        }

        for (const folder of ctx.folders) {
            const baseName = path.basename(folder.folder.fsPath);
            const guid = Math.random().toString(36).substring(2, 10);
            const outputDir = singleFolderWorkspace
                ? diagnosticsDir
                : path.join(diagnosticsDir, baseName);
            await fsPromises.mkdir(outputDir, { recursive: true });
            await writeLogFile(outputDir, `${baseName}-${guid}-settings.txt`, settingsLogs(folder));

            if (captureMode === "Full") {
                await writeLogFile(
                    outputDir,
                    `${baseName}-${guid}-source-code-diagnostics.txt`,
                    diagnosticLogs()
                );

                // The `sourcekit-lsp diagnose` command is only available in 6.0 and higher.
                if (folder.toolchain.swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0))) {
                    await sourcekitDiagnose(folder, outputDir);
                } else if (
                    vscode.workspace
                        .getConfiguration("sourcekit-lsp")
                        .get<string>("trace.server", "off") !== "off"
                ) {
                    const logFile = sourceKitLogFile(folder);
                    if (logFile) {
                        await copyLogFile(outputDir, logFile);
                    }
                }

                // Copy lldb-dap logs
                const lldbDapLogs = lldbDapLogFolder(folder.workspaceFolder);
                if (lldbDapLogs && !archivedLldbDapLogFolders.has(lldbDapLogs)) {
                    archivedLldbDapLogFolders.add(lldbDapLogs);
                    await copyLogFolder(ctx, outputDir, lldbDapLogs);
                }
            }
        }
        // Leave at end in case log above
        await copyLogFile(diagnosticsDir, extensionLogFile(ctx));

        archive.directory(diagnosticsDir, false);
        void archive.finalize();
        await archivingDone;

        // Clean up the diagnostics directory, leaving `zipFilePath` with the zip file.
        await fsPromises.rm(diagnosticsDir, { recursive: true, force: true });

        ctx.logger.info(`Saved diagnostics to ${zipFilePath}`);
        await showCapturedDiagnosticsResults(zipFilePath);

        return zipFilePath;
    } catch (error) {
        void vscode.window.showErrorMessage(`Unable to capture diagnostic logs: ${error}`);
    }
}

function configureZipArchiver(zipFilePath: string): {
    archive: archiver.Archiver;
    done: Promise<void>;
} {
    const output = fs.createWriteStream(zipFilePath);
    // Create an archive with max compression
    const archive = archiver.create("zip", {
        zlib: { level: 9 },
    });
    const { promise, resolve, reject } = destructuredPromise<void>();
    output.once("close", () => {
        archive.removeListener("error", reject);
        resolve();
    });
    archive.once("error", err => {
        output.removeListener("close", resolve);
        reject(err);
    });
    archive.pipe(output);
    return { archive, done: promise };
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
    if (ctx.globalToolchainSwiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0))) {
        const fullButton = "Capture Full Diagnostics";
        const minimalButton = "Capture Minimal Diagnostics";
        const buttons = allowMinimalCapture ? [fullButton, minimalButton] : [fullButton];
        const fullCaptureResult = await vscode.window.showInformationMessage(
            `A Diagnostic Bundle collects information that helps the developers of the Swift for VS Code extension diagnose and fix issues.

This information includes:
- Extension logs
- Extension settings
- Versions of Swift installed on your system

If you allow capturing a Full Diagnostic Bundle, the information will also include:
- Log messages emitted by LLDB DAP
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

async function showCapturedDiagnosticsResults(diagnosticsPath: string) {
    const showInFinderButton = `Show In ${showCommandType()}`;
    const copyPath = "Copy Path to Clipboard";
    const result = await vscode.window.showInformationMessage(
        `Saved diagnostic logs to ${diagnosticsPath}`,
        showInFinderButton,
        copyPath
    );
    if (result === copyPath) {
        await vscode.env.clipboard.writeText(diagnosticsPath);
    } else if (result === showInFinderButton) {
        const dirToShow = path.dirname(diagnosticsPath);
        exec(showDirectoryCommand(dirToShow), error => {
            // Opening the explorer on windows returns an exit code of 1 despite opening successfully.
            if (error && process.platform !== "win32") {
                void vscode.window.showErrorMessage(
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
    await fsPromises.writeFile(path.join(dir, name), logs);
}

async function copyLogFile(dir: string, filePath: string) {
    await fsPromises.copyFile(filePath, path.join(dir, path.basename(filePath)));
}

async function copyLogFolder(ctx: WorkspaceContext, dir: string, folderPath: string) {
    try {
        const lldbLogFiles = await fsPromises.readdir(folderPath);
        for (const log of lldbLogFiles) {
            await copyLogFile(dir, path.join(folderPath, log));
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            ctx.logger.error(`Failed to read log files from ${folderPath}: ${error}`);
        }
    }
}

/**
 * Creates a directory for diagnostics zip files, located in the system's temporary directory.
 */
async function createDiagnosticsZipDir(): Promise<string> {
    const diagnosticsDir = path.join(tmpdir(), "vscode-diagnostics", formatDateString(new Date()));
    await fsPromises.mkdir(diagnosticsDir, { recursive: true });
    return diagnosticsDir;
}

function extensionLogFile(ctx: WorkspaceContext): string {
    return ctx.logger.logFilePath;
}

function defaultLldbDapLogFolder(ctx: WorkspaceContext): string {
    const rootLogFolder = path.dirname(ctx.loggerFactory.logFolderUri.fsPath);
    return path.join(rootLogFolder, Extension.LLDBDAP);
}

function lldbDapLogFolder(workspaceFolder?: vscode.WorkspaceFolder): string | undefined {
    const config = vscode.workspace.workspaceFile
        ? vscode.workspace.getConfiguration("lldb-dap")
        : vscode.workspace.getConfiguration("lldb-dap", workspaceFolder);
    let logFolder = config.get<string>("logFolder");
    if (!logFolder) {
        return;
    } else if (!path.isAbsolute(logFolder)) {
        const logFolderSettingInfo = config.inspect<string>("logFolder");
        if (logFolderSettingInfo?.workspaceFolderValue && workspaceFolder) {
            logFolder = path.join(workspaceFolder.uri.fsPath, logFolder);
        } else if (logFolderSettingInfo?.workspaceValue && vscode.workspace.workspaceFile) {
            logFolder = path.join(path.dirname(vscode.workspace.workspaceFile.fsPath), logFolder);
        } else if (vscode.workspace.workspaceFolders?.length) {
            logFolder = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, logFolder);
        }
    }
    return logFolder;
}

function settingsLogs(ctx: FolderContext): string {
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

function sourceKitLogFile(folder: FolderContext) {
    const languageClient = folder.workspaceContext.languageClientManager.get(folder);
    return languageClient.languageClientOutputChannel?.logFilePath;
}

async function sourcekitDiagnose(ctx: FolderContext, dir: string) {
    const sourcekitDiagnosticDir = path.join(dir, "sourcekit-lsp");
    await fsPromises.mkdir(sourcekitDiagnosticDir);

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
                ctx ?? undefined
            );
        }
    );
}

function progressUpdatingWritable(updateProgress: (str: string) => void): Writable {
    return new Writable({
        write(chunk, _encoding, callback) {
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
