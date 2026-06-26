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
import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { SwiftToolchain } from "../toolchain/toolchain";
import { AsyncDisposable, Disposable } from "../utilities/Disposable";
import { isExcluded } from "../utilities/filesystem";
import { SourceKitLanguageClient } from "./client/SourceKitLanguageClient";

/**
 * Manages the creation of LanguageClient instances for workspace folders.
 *
 * A LanguageClient will be created for each unique toolchain version. If two
 * folders share the same toolchain version then they will share the same LanguageClient.
 * This ensures that a folder always uses the LanguageClient bundled with its desired toolchain.
 */
export class LanguageClientToolchainCoordinator implements AsyncDisposable {
    private subscriptions: Disposable[] = [];
    private clients: SourceKitLanguageClient[] = [];

    private get logger(): SwiftLogger {
        return this.workspaceContext.logger;
    }

    public constructor(
        private workspaceContext: WorkspaceContext,
        private options: {
            createLanguageClient?(
                toolchain: SwiftToolchain,
                workspaceContext: WorkspaceContext
            ): SourceKitLanguageClient;
        } = {}
    ) {
        this.subscriptions.push(
            workspaceContext.onDidChangeFolders(async ({ folder, operation }) => {
                await this.handleFolderChangeEvent(folder, operation);
            }),
            vscode.workspace.onDidChangeConfiguration(this.handleConfigurationChangeEvent, this)
        );
    }

    private async handleConfigurationChangeEvent(
        event: vscode.ConfigurationChangeEvent
    ): Promise<void> {
        if (event.affectsConfiguration("swift.sourcekit-lsp.disable")) {
            if (configuration.lsp.disable) {
                await this.disposeAllClients();
            } else {
                await Promise.all(
                    this.workspaceContext.folders.map(folder => {
                        return this.handleFolderChangeEvent(folder, FolderOperation.add);
                    })
                );
            }
            return;
        }

        const restartSettings = [
            "swift.swiftSDK",
            "swift.sourcekit-lsp.serverPath",
            "swift.sourcekit-lsp.serverArguments",
            "swift.sourcekit-lsp.supported-languages",
            "swift.sourcekit-lsp.backgroundIndexing",
            "swift.sourcekit-lsp.support-c-cpp",
        ];
        if (restartSettings.some(s => event.affectsConfiguration(s))) {
            await Promise.all(this.clients.map(c => c.restart()));
        }
    }

    private async handleFolderChangeEvent(
        folder: FolderContext | null,
        operation: FolderOperation
    ): Promise<void> {
        if (configuration.lsp.disable || !folder || isExcluded(folder.workspaceFolder.uri)) {
            return;
        }
        switch (operation) {
            case FolderOperation.swiftVersionUpdated: {
                const originalClient = this.clients.find(c => c.addedFolders.includes(folder));
                if (originalClient) {
                    await originalClient.removeFolder(folder);
                    if (originalClient.addedFolders.length === 0) {
                        this.clients = this.clients.filter(c => c !== originalClient);
                        originalClient.dispose().catch(e => this.logger.error(e));
                    }
                }
                const newClient = await this.getOrCreateClient(folder);
                await newClient.addFolder(folder);
                break;
            }
            case FolderOperation.add: {
                const client = await this.getOrCreateClient(folder);
                await client.addFolder(folder);
                break;
            }
            case FolderOperation.remove: {
                const client = await this.getOrCreateClient(folder);
                await client.removeFolder(folder);
                if (client.addedFolders.length === 0) {
                    this.clients = this.clients.filter(c => c !== client);
                    await client.dispose();
                }
                break;
            }
        }
    }

    public getAllClients(): SourceKitLanguageClient[] {
        return this.clients.slice();
    }

    /**
     * Returns the SourceKitLanguageClient for the supplied folder.
     */
    public getClient(folder: FolderContext): SourceKitLanguageClient {
        const client = this.clients.find(c => c.addedFolders.includes(folder));
        if (!client) {
            throw new Error(
                "SourceKitLanguageClient has not yet been created. This is a bug, please file an issue at https://github.com/swiftlang/vscode-swift/issues"
            );
        }
        return client;
    }

    /**
     * Stops all SourceKitLanguageClient instances.
     * This should be called when the extension is deactivated.
     */
    public async stop() {
        await Promise.all(this.clients.map(c => c.stop()));
    }

    private async getOrCreateClient(folder: FolderContext): Promise<SourceKitLanguageClient> {
        let client = this.clients.find(c => c.swiftVersion.isEqualTo(folder.swiftVersion));
        if (!client) {
            client = this.createLanguageClient(folder.toolchain);
            await client.addFolder(folder);
            this.clients.push(client);
            await client.start();
        }
        return client;
    }

    private createLanguageClient(toolchain: SwiftToolchain): SourceKitLanguageClient {
        if (this.options.createLanguageClient) {
            return this.options.createLanguageClient(toolchain, this.workspaceContext);
        }
        return new SourceKitLanguageClient(toolchain, this.workspaceContext);
    }

    private async disposeAllClients(): Promise<void> {
        const clientsToDispose = this.clients.slice();
        this.clients = [];
        await Promise.all(
            clientsToDispose.map(c =>
                c.dispose().catch(error => {
                    this.logger.error(
                        Error(`Failed to dispose of SourceKit-LSP (${c.swiftVersion})`, {
                            cause: error,
                        })
                    );
                })
            )
        );
    }

    async dispose(): Promise<void> {
        this.subscriptions.forEach(item => item.dispose());
        await this.disposeAllClients();
    }
}
