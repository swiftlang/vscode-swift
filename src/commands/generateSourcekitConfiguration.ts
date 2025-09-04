//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { basename, dirname, join } from "path";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { WorkspaceContext } from "../WorkspaceContext";
import configuration from "../configuration";
import { selectFolder } from "../ui/SelectFolderQuickPick";
import restartLSPServer from "./restartLSPServer";

export const sourcekitDotFolder: string = ".sourcekit-lsp";
export const sourcekitConfigFileName: string = "config.json";

export async function generateSourcekitConfiguration(ctx: WorkspaceContext): Promise<boolean> {
    if (ctx.folders.length === 0) {
        return false;
    }

    if (ctx.folders.length === 1) {
        const folder = ctx.folders[0];
        const success = await createSourcekitConfiguration(ctx, folder);
        void vscode.window.showTextDocument(vscode.Uri.file(sourcekitConfigFilePath(folder)));
        return success;
    }

    const foldersToGenerate: FolderContext[] = await selectFolder(
        ctx,
        "Select a folder to generate a SourceKit-LSP configuration for"
    );
    if (!foldersToGenerate.length) {
        return false;
    }

    return (
        await Promise.all(
            foldersToGenerate.map(folder => createSourcekitConfiguration(ctx, folder))
        )
    ).reduceRight((prev, curr) => prev || curr);
}

export const sourcekitFolderPath = (f: FolderContext) => join(f.folder.fsPath, sourcekitDotFolder);
export const sourcekitConfigFilePath = (f: FolderContext) =>
    join(sourcekitFolderPath(f), sourcekitConfigFileName);

async function createSourcekitConfiguration(
    workspaceContext: WorkspaceContext,
    folderContext: FolderContext
): Promise<boolean> {
    const sourcekitFolder = vscode.Uri.file(sourcekitFolderPath(folderContext));
    const sourcekitConfigFile = vscode.Uri.file(sourcekitConfigFilePath(folderContext));

    try {
        await vscode.workspace.fs.stat(sourcekitConfigFile);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            workspaceContext.logger.error(
                `Failed to read file at ${sourcekitConfigFile.fsPath}: ${error}`
            );
        }
        // Ignore, don't care if the file doesn't exist yet
    }

    try {
        const stats = await vscode.workspace.fs.stat(sourcekitFolder);
        if (stats.type !== vscode.FileType.Directory) {
            void vscode.window.showErrorMessage(
                `File ${sourcekitFolder.fsPath} already exists but is not a directory`
            );
            return false;
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            workspaceContext.logger.error(
                `Failed to read folder at ${sourcekitFolder.fsPath}: ${error}`
            );
        }
        await vscode.workspace.fs.createDirectory(sourcekitFolder);
    }
    try {
        const url = await determineSchemaURL(folderContext);
        await vscode.workspace.fs.writeFile(
            sourcekitConfigFile,
            Buffer.from(
                JSON.stringify(
                    {
                        $schema: url,
                    },
                    undefined,
                    2
                )
            )
        );
    } catch (e) {
        void vscode.window.showErrorMessage(`${e}`);
        return false;
    }
    return true;
}

const schemaURL = (branch: string) =>
    `https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/refs/heads/${branch}/config.schema.json`;

async function checkURLExists(url: string): Promise<boolean> {
    try {
        const response = await fetch(url, { method: "HEAD" });
        if (response.ok) {
            return true;
        } else if (response.status !== 404) {
            throw new Error(`Received exit code ${response.status} when trying to fetch ${url}`);
        }
        return false;
    } catch {
        return false;
    }
}

export async function determineSchemaURL(folderContext: FolderContext): Promise<string> {
    const version = folderContext.toolchain.swiftVersion;
    const versionString = `${version.major}.${version.minor}`;
    let branch =
        configuration.lspConfigurationBranch || (version.dev ? "main" : `release/${versionString}`);
    if (!(await checkURLExists(schemaURL(branch)))) {
        branch = "main";
    }
    return schemaURL(branch);
}

async function getValidatedFolderContext(
    uri: vscode.Uri,
    workspaceContext: WorkspaceContext
): Promise<FolderContext | null> {
    const folder = await workspaceContext.getPackageFolder(uri);
    if (!folder) {
        return null;
    }
    const folderContext = folder as FolderContext;
    if (!folderContext.name) {
        return null; // Not a FolderContext if no "name"
    }
    if (
        !(
            basename(dirname(uri.fsPath)) === sourcekitDotFolder &&
            basename(uri.fsPath) === sourcekitConfigFileName
        )
    ) {
        return null;
    }
    return folderContext;
}

async function checkDocumentSchema(doc: vscode.TextDocument, workspaceContext: WorkspaceContext) {
    const folderContext = await getValidatedFolderContext(doc.uri, workspaceContext);
    if (!folderContext) {
        return;
    }
    let buffer: Uint8Array;
    try {
        buffer = await vscode.workspace.fs.readFile(doc.uri);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            workspaceContext.logger.error(`Failed to read file at ${doc.uri.fsPath}: ${error}`);
        }
        return;
    }
    let config;
    try {
        const contents = Buffer.from(buffer).toString("utf-8");
        config = JSON.parse(contents);
    } catch (error) {
        workspaceContext.logger.error(`Failed to parse JSON from  ${doc.uri.fsPath}: ${error}`);
        return;
    }
    const schema = config.$schema;
    if (!schema) {
        return;
    }
    const newUrl = await determineSchemaURL(folderContext);
    if (newUrl === schema) {
        return;
    }
    const result = await vscode.window.showInformationMessage(
        `The $schema property for ${doc.uri.fsPath} is not set to the version of the Swift toolchain that you are using. Would you like to update the $schema property?`,
        "Yes",
        "No",
        "Don't Ask Again"
    );
    if (result === "Yes") {
        config.$schema = newUrl;
        await vscode.workspace.fs.writeFile(
            doc.uri,
            Buffer.from(JSON.stringify(config, undefined, 2))
        );
        return;
    } else if (result === "Don't Ask Again") {
        configuration.checkLspConfigurationSchema = false;
        return;
    }
}

export async function handleSchemaUpdate(
    doc: vscode.TextDocument,
    workspaceContext: WorkspaceContext
) {
    if (!configuration.checkLspConfigurationSchema) {
        return;
    }
    await checkDocumentSchema(doc, workspaceContext);
}

export function registerSourceKitSchemaWatcher(
    workspaceContext: WorkspaceContext
): vscode.Disposable {
    const onDidOpenDisposable = vscode.workspace.onDidOpenTextDocument(doc => {
        void handleSchemaUpdate(doc, workspaceContext);
    });
    const configFileWatcher = vscode.workspace.createFileSystemWatcher(
        `**/${sourcekitDotFolder}/${sourcekitConfigFileName}`
    );
    const onDidChangeDisposable = configFileWatcher.onDidChange(async uri => {
        await handleConfigFileChange(uri, workspaceContext);
    });
    const onDidDeleteDisposable = configFileWatcher.onDidDelete(async uri => {
        await handleConfigFileChange(uri, workspaceContext);
    });
    const onDidCreateDisposable = configFileWatcher.onDidCreate(async uri => {
        await handleConfigFileChange(uri, workspaceContext);
    });
    return vscode.Disposable.from(
        onDidOpenDisposable,
        configFileWatcher,
        onDidChangeDisposable,
        onDidDeleteDisposable,
        onDidCreateDisposable
    );
}

export async function handleConfigFileChange(
    configUri: vscode.Uri,
    workspaceContext: WorkspaceContext
): Promise<void> {
    const folderContext = await getValidatedFolderContext(configUri, workspaceContext);
    if (!folderContext) {
        return;
    }
    const result = await vscode.window.showInformationMessage(
        `The SourceKit-LSP configuration file has been modified. Would you like to restart the language server to apply the changes?`,
        "Restart LSP Server",
        "Not Now"
    );
    if (result === "Restart LSP Server") {
        await restartLSPServer(workspaceContext);
    }
}
