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
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { WorkspaceContext } from "../WorkspaceContext";
import {
    determineSchemaURL,
    sourcekitConfigFilePath,
} from "../commands/generateSourcekitConfiguration";

/**
 * Manages dynamic JSON schema associations for sourcekit-lsp config files.
 * This allows VS Code to provide validation and IntelliSense using the
 * appropriate schema (local or remote) based on the toolchain.
 */
export class SourcekitSchemaRegistry {
    private disposables: vscode.Disposable[] = [];

    constructor(private workspaceContext: WorkspaceContext) {}

    /**
     * Registers event handlers to dynamically configure JSON schemas
     * for sourcekit-lsp config documents.
     */
    register(): vscode.Disposable {
        // Handle documents that are already open
        vscode.workspace.textDocuments.forEach(doc => {
            void this.configureSchemaForDocument(doc);
        });

        // Handle newly opened documents
        const onDidOpenDisposable = vscode.workspace.onDidOpenTextDocument(doc => {
            void this.configureSchemaForDocument(doc);
        });

        this.disposables.push(onDidOpenDisposable);

        return vscode.Disposable.from(...this.disposables);
    }

    /**
     * Configures the JSON schema for a document if it's a sourcekit-lsp config file.
     */
    private async configureSchemaForDocument(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== "json") {
            return;
        }

        const folderContext = await this.getFolderContextForDocument(document);
        if (!folderContext) {
            return;
        }

        const schemaUrl = await determineSchemaURL(folderContext);

        // Use VS Code's JSON language configuration API to associate the schema
        await vscode.commands.executeCommand("json.setSchema", document.uri.toString(), schemaUrl);
    }

    /**
     * Gets the FolderContext for a document if it's a sourcekit-lsp config file.
     */
    private async getFolderContextForDocument(
        document: vscode.TextDocument
    ): Promise<FolderContext | null> {
        for (const folderContext of this.workspaceContext.folders) {
            const configPath = sourcekitConfigFilePath(folderContext);
            if (document.uri.fsPath === configPath) {
                return folderContext;
            }
        }
        return null;
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
