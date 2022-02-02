//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

"use strict";
import * as vscode from "vscode";
import * as langclient from "vscode-languageclient/node";
import configuration from "../configuration";
import { getSwiftExecutable } from "../utilities/utilities";
import { Version } from "../utilities/version";
import { FolderEvent, WorkspaceContext } from "../WorkspaceContext";
import { activateInlayHints } from "./inlayHints";

/** Manages the creation and destruction of Language clients as we move between
 * workspace folders
 */
export class LanguageClientManager {
    /** current running client */
    public languageClient?: langclient.LanguageClient;
    private observeFoldersDisposable: vscode.Disposable;
    private onDidCreateFileDisposable?: vscode.Disposable;
    private onDidDeleteFileDisposable?: vscode.Disposable;
    private inlayHints?: vscode.Disposable;
    private supportsDidChangedWatchedFiles: boolean;
    private startedPromise?: Promise<void>;
    private restartPromise?: Promise<void>;

    constructor(workspaceContext: WorkspaceContext) {
        // stop and start server for each folder based on which file I am looking at
        this.observeFoldersDisposable = workspaceContext.observeFolders(
            async (folderContext, event) => {
                switch (event) {
                    case FolderEvent.focus:
                        await this.setupLanguageClient(folderContext?.folder);
                        break;
                    case FolderEvent.unfocus:
                        // if in the middle of a restart then we have to wait until that
                        // restart has finished
                        if (this.restartPromise) {
                            await this.restartPromise;
                        }
                        if (this.languageClient) {
                            const client = this.languageClient;
                            this.languageClient = undefined;
                            this.inlayHints?.dispose();
                            this.inlayHints = undefined;
                            // wait for client to start before stopping it
                            if (this.startedPromise) {
                                await this.startedPromise;
                            }
                            await client.stop();
                        }
                        break;
                }
            }
        );
        // restart LSP server on creation of a new file
        this.onDidCreateFileDisposable = vscode.workspace.onDidCreateFiles(() => {
            this.restartLanguageClient();
        });
        // restart LSP server on deletion of a file
        this.onDidDeleteFileDisposable = vscode.workspace.onDidDeleteFiles(() => {
            this.restartLanguageClient();
        });

        // if we are running swift 5.6 or greater then LSP supports `didChangeWatchedFiles` message
        this.supportsDidChangedWatchedFiles = workspaceContext.swiftVersion.isGreaterThanOrEqual(
            new Version(5, 6, 0)
        );
    }

    dispose() {
        this.observeFoldersDisposable.dispose();
        this.onDidCreateFileDisposable?.dispose();
        this.onDidDeleteFileDisposable?.dispose();
        this.inlayHints?.dispose();
        this.languageClient?.stop();
    }

    /** Restart language client */
    async restartLanguageClient() {
        // if language client is nil or workspace/didChangeWatchedFiles message is supported
        // then don't need to restart
        if (!this.languageClient || this.supportsDidChangedWatchedFiles) {
            return;
        }

        const client = this.languageClient;
        this.languageClient = undefined;
        // get rid of inlay hints
        this.inlayHints?.dispose();
        this.inlayHints = undefined;
        // wait for client to start before stopping it
        if (this.startedPromise) {
            await this.startedPromise;
        }
        // create promise that is resolved once restart is finished
        this.restartPromise = client
            .stop()
            .then(async () => {
                if (client.clientOptions.workspaceFolder === undefined) {
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 10000));
                await this.setupLanguageClient(client.clientOptions.workspaceFolder);
            })
            .then(() => {
                this.restartPromise = undefined;
            });
        return this.restartPromise;
    }

    private async setupLanguageClient(folder?: vscode.WorkspaceFolder) {
        const client = await this.createLSPClient(folder);
        client.start();

        console.log(`SourceKit-LSP setup for ${folder?.name}`);

        this.supportsDidChangedWatchedFiles = false;
        this.languageClient = client;

        client.onReady().then(() => {
            this.inlayHints = activateInlayHints(client);
        });
    }

    private async createLSPClient(
        folder?: vscode.WorkspaceFolder
    ): Promise<langclient.LanguageClient> {
        const serverPathConfig = configuration.lsp.serverPath;
        const serverPath =
            serverPathConfig.length > 0 ? serverPathConfig : getSwiftExecutable("sourcekit-lsp");
        const sourcekit: langclient.Executable = {
            command: serverPath,
            args: configuration.lsp.serverArguments,
        };

        const toolchain = configuration.lsp.toolchainPath;
        if (toolchain.length > 0) {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            sourcekit.options = { env: { ...process.env, SOURCEKIT_TOOLCHAIN_PATH: toolchain } };
        }

        const serverOptions: langclient.ServerOptions = sourcekit;

        const clientOptions: langclient.LanguageClientOptions = {
            documentSelector: [
                { scheme: "file", language: "swift" },
                { scheme: "untitled", language: "swift" },
                { scheme: "file", language: "c" },
                { scheme: "untitled", language: "c" },
                { scheme: "file", language: "cpp" },
                { scheme: "untitled", language: "cpp" },
                { scheme: "file", language: "objective-c" },
                { scheme: "untitled", language: "objective-c" },
                { scheme: "file", language: "objective-cpp" },
                { scheme: "untitled", language: "objective-cpp" },
            ],
            revealOutputChannelOn: langclient.RevealOutputChannelOn.Never,
            workspaceFolder: folder,
        };

        return new langclient.LanguageClient(
            "sourcekit-lsp",
            "SourceKit Language Server",
            serverOptions,
            clientOptions
        );
    }
}
