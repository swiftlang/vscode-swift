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
import { exec } from "child_process";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { Writable } from "stream";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { WorkspaceContext } from "../WorkspaceContext";
import configuration from "../configuration";
import { DebugAdapter, LaunchConfigType } from "../debugger/debugAdapter";
import { SwiftLogger } from "../logging/SwiftLogger";
import { SwiftToolchain } from "../toolchain/toolchain";
import { Extension } from "../utilities/extensions";
import { destructuredPromise, execFileStreamOutput, randomString } from "../utilities/utilities";
import { Version } from "../utilities/version";

export async function promptForDiagnostics(ctx: WorkspaceContext) {
    const ok = "O";
    const cancel = "Cancel";
    const result = await vscode.window.showInformationMessage(
        "SourceKit-LSP has been restored. Would you like to capture a diagnostic bundle to file an issue?",
        ok,
        cancel
    );

    if (!result || result === cancel) {
        return;
    }

    return await captureDiagnostics(
        {
            logFolderUri: ctx.loggerFactory.logFolderUri,
            globalToolchain: ctx.globalToolchain,
            folders: ctx.folders,
            requiresFullDiagnostics: true,
            showSwiftOutputChannel: () => ctx.showSwiftOutputChannel(),
        },
        ctx.logger
    );
}

export interface CaptureDiagnosticsOptions {
    logFolderUri: vscode.Uri;
    globalToolchain?: SwiftToolchain;
    folders?: FolderContext[];
    requiresFullDiagnostics?: boolean;
    showSwiftOutputChannel(): void;
}

export async function captureDiagnostics(
    options: CaptureDiagnosticsOptions,
    logger: SwiftLogger
): Promise<string | undefined> {
    const {
        logFolderUri,
        globalToolchain,
        folders = [],
        requiresFullDiagnostics = false,
    } = options;
    try {
        const captureMode = await promptForDiagnosticsMode(!requiresFullDiagnostics);
        if (!captureMode) {
            return;
        }

        const diagnosticsDir = path.join(
            tmpdir(),
            `vscode-diagnostics-${formatDateString(new Date())}`
        );

        await fsPromises.mkdir(diagnosticsDir);

        const zipDir = await createDiagnosticsZipDir();
        const zipFilePath = path.join(zipDir, `${path.basename(diagnosticsDir)}.zip`);
        const { archive, done: archivingDone } = configureZipArchiver(zipFilePath);

        const archivedLldbDapLogFolders = await captureGlobalLldbDapLogs(
            globalToolchain?.swiftVersion,
            logFolderUri,
            captureMode,
            diagnosticsDir,
            logger
        );

        await Promise.all(
            folders.map(folder =>
                captureFolderDiagnostics(
                    folder,
                    captureMode,
                    diagnosticsDir,
                    archivedLldbDapLogFolders,
                    logger
                )
            )
        );

        await copyLogFolder(diagnosticsDir, logFolderUri.fsPath, logger);

        archive.directory(diagnosticsDir, false);
        void archive.finalize();
        await archivingDone;

        await fsPromises.rm(diagnosticsDir, { recursive: true, force: true });

        logger.info(`Saved diagnostics to ${zipFilePath}`);
        await showCapturedDiagnosticsResults(zipFilePath);

        return zipFilePath;
    } catch (error) {
        logger.error(Error("Failed to capture diagnostics bundle.", { cause: error }));
        void vscode.window.showErrorMessage(`Failed to capture diagnostics bundle: ${error}`);
    }
}

async function captureGlobalLldbDapLogs(
    globalToolchainVersion: Version | undefined,
    logFolderUri: vscode.Uri,
    captureMode: "Minimal" | "Full",
    diagnosticsDir: string,
    logger: SwiftLogger
): Promise<Set<string>> {
    const includeLldbDapLogs = globalToolchainVersion
        ? DebugAdapter.getLaunchConfigType(globalToolchainVersion) === LaunchConfigType.LLDB_DAP
        : false;

    if (captureMode !== "Full" || !includeLldbDapLogs) {
        return new Set();
    }

    const rootLogFolder = path.dirname(logFolderUri.fsPath);
    const logFolder = path.join(rootLogFolder, Extension.LLDBDAP);
    if (!logFolder) {
        return new Set();
    }
    await copyLogFolder(diagnosticsDir, logFolder, logger);
    return new Set([logFolder]);
}

async function captureFolderDiagnostics(
    folder: FolderContext,
    captureMode: "Minimal" | "Full",
    outputDir: string,
    archivedLldbDapLogFolders: Set<string>,
    logger: SwiftLogger
): Promise<void> {
    if (!folder.isRootFolder) {
        const baseName = path.basename(folder.folder.fsPath);
        const guid = randomString(10, 36);
        outputDir = path.join(outputDir, `${baseName}-${guid}`);
    }

    await fsPromises.mkdir(outputDir, { recursive: true });
    await writeLogFile(outputDir, `settings.txt`, settingsLogs(folder));

    if (captureMode !== "Full") {
        return;
    }

    await writeLogFile(outputDir, `source-code-diagnostics.txt`, diagnosticLogs());

    if (folder.toolchain.swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0))) {
        await sourcekitDiagnose(folder, outputDir);
    }
    await captureFolderLldbDapLogs(folder, outputDir, archivedLldbDapLogFolders, logger);
}

async function captureFolderLldbDapLogs(
    folder: FolderContext,
    outputDir: string,
    archivedLldbDapLogFolders: Set<string>,
    logger: SwiftLogger
): Promise<void> {
    const includeLldbDapLogs = DebugAdapter.getLaunchConfigType(folder.swiftVersion);
    if (!includeLldbDapLogs) {
        return;
    }

    const lldbDapLogs = lldbDapLogFolder(folder.workspaceFolder);
    if (!lldbDapLogs || archivedLldbDapLogFolders.has(lldbDapLogs)) {
        return;
    }

    archivedLldbDapLogFolders.add(lldbDapLogs);
    await copyLogFolder(outputDir, lldbDapLogs, logger);
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

async function promptForDiagnosticsMode(
    allowMinimalCapture: boolean
): Promise<"Minimal" | "Full" | undefined> {
    const fullButton = "Capture Full Diagnostics";
    const minimalButton = "Capture Minimal Diagnostics";
    const buttons = allowMinimalCapture ? [fullButton, minimalButton] : [fullButton];
    let detail = `A Diagnostic Bundle collects information that helps the developers of the Swift for VS Code extension diagnose and fix issues.

This information includes:
- Extension logs
- Extension settings
- Versions of Swift installed on your system

If you allow capturing a Full Diagnostic Bundle, the information will also include:
- Crash logs from SourceKit
- Log messages emitted by SourceKit
- If possible, a minimized project that caused SourceKit to crash
- If possible, a minimized project that caused the Swift compiler to crash
- If available, log messages emitted by LLDB DAP

All information is collected locally and you can inspect the diagnose bundle before sharing it with developers of the Swift for VS Code extension.

Please file an issue with a description of the problem you are seeing at https://github.com/swiftlang/vscode-swift, and attach this diagnose bundle.`;
    if (allowMinimalCapture) {
        detail += `\n\nIf you wish to omit potentially sensitive information choose "${minimalButton}"`;
    }
    const fullCaptureResult = await vscode.window.showInformationMessage(
        "Capture Swift Diagnostic Bundle",
        {
            modal: true,
            detail,
        },
        ...buttons
    );
    if (!fullCaptureResult) {
        return undefined;
    }

    return fullCaptureResult === fullButton ? "Full" : "Minimal";
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
        // eslint-disable-next-line sonarjs/os-command
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

async function copyLogFile(dir: string, filePath: string, logger: SwiftLogger) {
    try {
        await fsPromises.copyFile(filePath, path.join(dir, path.basename(filePath)));
    } catch (error) {
        logger.error(
            Error(`Failed to add "${filePath}" to captured diagnostics`, {
                cause: error,
            })
        );
    }
}

async function copyLogFolder(dir: string, folderPath: string, logger: SwiftLogger) {
    const logFiles = await fsPromises.readdir(folderPath, { recursive: true, withFileTypes: true });
    await Promise.all(
        logFiles
            .filter(entry => entry.isFile())
            .map(async ({ name, parentPath }) => {
                await copyLogFile(dir, path.join(parentPath, name), logger);
            })
    );
}

/**
 * Creates a directory for diagnostics zip files, located in the system's temporary directory.
 */
async function createDiagnosticsZipDir(): Promise<string> {
    const diagnosticsDir = path.join(tmpdir(), "vscode-diagnostics", formatDateString(new Date()));
    await fsPromises.mkdir(diagnosticsDir, { recursive: true });
    return diagnosticsDir;
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

async function sourcekitDiagnose(ctx: FolderContext, dir: string) {
    const sourcekitDiagnosticDir = path.join(dir, "sourcekit-lsp");
    await fsPromises.mkdir(sourcekitDiagnosticDir, { recursive: true });

    const lspConfig = configuration.lsp;
    const serverPathConfig = lspConfig.serverPath;
    const inv =
        serverPathConfig.length > 0
            ? { command: serverPathConfig, args: [] }
            : ctx.toolchain.getToolchainInvocation("sourcekit-lsp", []);

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
        },
        async progress => {
            progress.report({ message: "Diagnosing SourceKit-LSP..." });
            let lastProgress = 0;
            const writableStream = progressUpdatingWritable(percentStr => {
                const percent = parseInt(percentStr, 10);
                progress.report({
                    message: `Diagnosing SourceKit-LSP: ${percent}%`,
                    increment: percent - lastProgress,
                });
                lastProgress = percent;
            });

            await execFileStreamOutput(
                inv.command,
                [
                    ...inv.args,
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
            const percent = /^(\d+)%/.exec(str);
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
