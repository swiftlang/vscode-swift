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
            this.logger.debug(
                `Configuration changed: swift.sourcekit-lsp.disable is now ${configuration.lsp.disable}`,
                { label: "SourceKit-LSP" }
            );
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
        const changedSettings = restartSettings.filter(s => event.affectsConfiguration(s));
        if (changedSettings.length > 0) {
            this.logger.debug(
                `Restarting ${this.clients.length} language clients due to configuration change: ${changedSettings.join(", ")}`,
                { label: "SourceKit-LSP" }
            );
            await Promise.all(this.clients.map(c => c.restart()));
            this.logger.trace("Language clients restarted after configuration change", {
                label: "SourceKit-LSP",
            });
        }
    }

    private async handleFolderChangeEvent(
        folder: FolderContext | null,
        operation: FolderOperation
    ): Promise<void> {
        if (configuration.lsp.disable || !folder || isExcluded(folder.workspaceFolder.uri)) {
            this.logger.trace(
                `Ignoring folder event ${operation}: hasFolder=${folder !== null}, lspDisabled=${configuration.lsp.disable}`,
                { label: folder?.name ?? "SourceKit-LSP" }
            );
            return;
        }
        switch (operation) {
            case FolderOperation.swiftVersionUpdated: {
                this.logger.debug(
                    `Swift version updated to ${folder.swiftVersion}, moving folder to new language client`,
                    { label: folder.name }
                );
                const originalClient = this.clients.find(c => c.addedFolders.includes(folder));
                if (originalClient) {
                    await originalClient.removeFolder(folder);
                    if (originalClient.addedFolders.length === 0) {
                        this.logger.debug(
                            `Disposing unused language client for Swift ${originalClient.swiftVersion}`,
                            { label: folder.name }
                        );
                        this.clients = this.clients.filter(c => c !== originalClient);
                        originalClient.dispose().catch(e => this.logger.error(e));
                    }
                }
                const newClient = await this.getOrCreateClient(folder);
                await newClient.addFolder(folder);
                this.logger.trace("Folder moved to new language client", { label: folder.name });
                break;
            }
            case FolderOperation.add: {
                this.logger.trace("Adding folder to language client", { label: folder.name });
                const client = await this.getOrCreateClient(folder);
                await client.addFolder(folder);
                this.logger.trace("Folder added to language client", { label: folder.name });
                break;
            }
            case FolderOperation.remove: {
                this.logger.trace("Removing folder from language client", { label: folder.name });
                const client = await this.getOrCreateClient(folder);
                await client.removeFolder(folder);
                if (client.addedFolders.length === 0) {
                    this.logger.debug(
                        `Disposing language client for Swift ${client.swiftVersion}, no folders remain`,
                        { label: folder.name }
                    );
                    this.clients = this.clients.filter(c => c !== client);
                    await client.dispose();
                }
                this.logger.trace("Folder removed from language client", { label: folder.name });
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
        this.logger.trace(`Stopping ${this.clients.length} language clients`, {
            label: "SourceKit-LSP",
        });
        await Promise.all(this.clients.map(c => c.stop()));
        this.logger.trace("Stopped all language clients", { label: "SourceKit-LSP" });
    }

    private async getOrCreateClient(folder: FolderContext): Promise<SourceKitLanguageClient> {
        let client = this.clients.find(c => c.swiftVersion.isEqualTo(folder.swiftVersion));
        if (!client) {
            this.logger.debug(
                `Creating language client for Swift ${folder.swiftVersion} (${folder.toolchain.swiftFolderPath})`,
                { label: folder.name }
            );
            client = this.createLanguageClient(folder.toolchain);
            await client.addFolder(folder);
            this.clients.push(client);
            this.logger.trace(`Starting language client for Swift ${folder.swiftVersion}`, {
                label: folder.name,
            });
            await client.start();
            this.logger.trace(`Language client for Swift ${folder.swiftVersion} started`, {
                label: folder.name,
            });
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
        this.logger.trace(`Disposing ${clientsToDispose.length} language clients`, {
            label: "SourceKit-LSP",
        });
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
        this.logger.trace("Disposed all language clients", { label: "SourceKit-LSP" });
    }

    async dispose(): Promise<void> {
        this.logger.trace("Disposing language client coordinator", { label: "SourceKit-LSP" });
        this.subscriptions.forEach(item => item.dispose());
        await this.disposeAllClients();
    }
}
