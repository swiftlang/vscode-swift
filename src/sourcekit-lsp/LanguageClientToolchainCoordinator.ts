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
import { SwiftLogger } from "../logging/SwiftLogger";
import { isExcluded } from "../utilities/filesystem";
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
    private clientCreationPromises: Map<string, Promise<LanguageClientManager>> = new Map();
    public readonly initialized: Promise<void>;
    private readonly logger: SwiftLogger;

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
        this.logger = workspaceContext.logger;
        this.subscriptions.push(
            // stop and start server for each folder based on which file I am looking at
            workspaceContext.onDidChangeFolders(async ({ folder, operation }) => {
                await this.handleEvent(folder, operation, languageClientFactory);
            })
        );

        // Add any folders already in the workspace context at the time of construction.
        // This is mainly for testing purposes, as this class should be created immediately
        // when the extension is activated and the workspace context is first created.
        const initPromises = workspaceContext.folders.map(folder =>
            this.handleEvent(folder, FolderOperation.add, languageClientFactory)
        );
        this.initialized = Promise.all(initPromises).then(() => {});
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

        switch (operation) {
            case FolderOperation.add: {
                this.logger.info(
                    `Coordinator: Adding folder ${FolderContext.uriName(folder.folder)} (Swift ${folder.swiftVersion})`
                );
                const client = await this.getClientForFolderSwiftVersion(
                    folder,
                    languageClientFactory
                );
                await client.addFolder(folder);
                break;
            }
            case FolderOperation.remove: {
                this.logger.info(
                    `Coordinator: Removing folder ${FolderContext.uriName(folder.folder)} (Swift ${folder.swiftVersion})`
                );
                const client = await this.getClientForFolderSwiftVersion(
                    folder,
                    languageClientFactory
                );
                await client.removeFolder(folder);
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
        this.logger.info(`Coordinator: Stopping ${this.clients.size} SourceKit-LSP client(s)`);
        for (const client of this.clients.values()) {
            await client.stop();
        }
        this.clients.clear();
        this.clientCreationPromises.clear();
    }

    private async getClientForFolderSwiftVersion(
        folder: FolderContext,
        factory: LanguageClientFactory
    ): Promise<LanguageClientManager> {
        const version = folder.swiftVersion.toString();

        // Check if client already exists
        const existing = this.clients.get(version);
        if (existing) {
            this.logger.info(
                `Coordinator: Reusing existing SourceKit-LSP client for Swift ${version}`
            );
            return existing;
        }

        // Check if client creation is already in progress
        const existingPromise = this.clientCreationPromises.get(version);
        if (existingPromise) {
            this.logger.info(
                `Coordinator: Waiting for in-progress SourceKit-LSP client creation for Swift ${version}`
            );
            return existingPromise;
        }

        // Create new client and track the promise to prevent race conditions
        this.logger.info(`Coordinator: Creating new SourceKit-LSP client for Swift ${version}`);
        const clientPromise = LanguageClientManager.create(folder, this.options, factory);
        this.clientCreationPromises.set(version, clientPromise);

        try {
            const client = await clientPromise;
            this.clients.set(version, client);
            return client;
        } finally {
            this.clientCreationPromises.delete(version);
        }
    }

    dispose() {
        this.subscriptions.forEach(item => item.dispose());
    }
}
