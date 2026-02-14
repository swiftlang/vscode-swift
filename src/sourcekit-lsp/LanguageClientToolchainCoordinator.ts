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
import { FolderOperation, WorkspaceContext } from "../WorkspaceContext";
import { isExcluded } from "../utilities/filesystem";
import { Version } from "../utilities/version";
import { LanguageClientFactory } from "./LanguageClientFactory";
import { LanguageClientManager } from "./LanguageClientManager";

/**
 * Manages the creation of LanguageClient instances for workspace folders.
 *
 * A LanguageClient will be created for each unique toolchain version. If two
 * folders share the same toolchain version then they will share the same LanguageClient.
 * This ensures that a folder always uses the LanguageClient bundled with its desired toolchain.
 */
export class LanguageClientToolchainCoordinator implements vscode.Disposable {
    private subscriptions: vscode.Disposable[] = [];
    private clients: Map<string, LanguageClientManager> = new Map();

    public constructor(
        workspaceContext: WorkspaceContext,
        private options: {
            onDocumentSymbols?: (
                folder: FolderContext,
                document: vscode.TextDocument,
                symbols: vscode.DocumentSymbol[] | null | undefined
            ) => void;
            onDocumentCodeLens?: (
                folder: FolderContext,
                document: vscode.TextDocument,
                symbols: vscode.CodeLens[] | null | undefined
            ) => void;
        } = {},
        languageClientFactory: LanguageClientFactory = new LanguageClientFactory() // used for testing only
    ) {
        this.subscriptions.push(
            // stop and start server for each folder based on which file I am looking at
            workspaceContext.onDidChangeFolders(async ({ folder, operation }) => {
                await this.handleEvent(folder, operation, languageClientFactory);
            })
        );

        // Add any folders already in the workspace context at the time of construction.
        // This is mainly for testing purposes, as this class should be created immediately
        // when the extension is activated and the workspace context is first created.
        for (const folder of workspaceContext.folders) {
            void this.handleEvent(folder, FolderOperation.add, languageClientFactory);
        }
    }

    private async handleEvent(
        folder: FolderContext | null,
        operation: FolderOperation,
        languageClientFactory: LanguageClientFactory
    ) {
        if (!folder) {
            return;
        }
        if (isExcluded(folder.workspaceFolder.uri)) {
            return;
        }
        const singleServer = folder.swiftVersion.isGreaterThanOrEqual(new Version(5, 7, 0));
        switch (operation) {
            case FolderOperation.add: {
                const client = await this.create(folder, singleServer, languageClientFactory);
                await (singleServer
                    ? client.addFolder(folder)
                    : client.setLanguageClientFolder(folder));
                break;
            }
            case FolderOperation.remove: {
                const client = await this.create(folder, singleServer, languageClientFactory);
                await client.removeFolder(folder);
                break;
            }
            case FolderOperation.focus: {
                if (!singleServer) {
                    const client = await this.create(folder, singleServer, languageClientFactory);
                    await client.setLanguageClientFolder(folder);
                }
                break;
            }
        }
    }

    /**
     * Returns the LanguageClientManager for the supplied folder.
     * @param folder
     * @returns
     */
    public get(folder: FolderContext): LanguageClientManager {
        return this.getByVersion(folder.swiftVersion.toString());
    }

    /**
     * Returns the LanguageClientManager for the supplied toolchain version.
     * @param folder
     * @returns
     */
    public getByVersion(version: string): LanguageClientManager {
        const client = this.clients.get(version);
        if (!client) {
            throw new Error(
                "LanguageClientManager has not yet been created. This is a bug, please file an issue at https://github.com/swiftlang/vscode-swift/issues"
            );
        }
        return client;
    }

    /**
     * Stops all LanguageClient instances.
     * This should be called when the extension is deactivated.
     */
    public async stop() {
        for (const client of this.clients.values()) {
            await client.stop();
        }
        this.clients.clear();
    }

    private async create(
        folder: FolderContext,
        singleServerSupport: boolean,
        languageClientFactory: LanguageClientFactory
    ): Promise<LanguageClientManager> {
        const versionString = folder.swiftVersion.toString();
        let client = this.clients.get(versionString);
        if (!client) {
            client = new LanguageClientManager(folder, this.options, languageClientFactory);
            this.clients.set(versionString, client);
            // Callers that must restart when switching folders will call setLanguageClientFolder themselves.
            if (singleServerSupport) {
                await client.setLanguageClientFolder(folder);
            }
        }
        return client;
    }

    dispose() {
        this.subscriptions.forEach(item => item.dispose());
        for (const client of this.clients.values()) {
            client.dispose();
        }
        this.clients.clear();
    }
}
