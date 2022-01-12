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
import { getSwiftExecutable } from "../utilities";
import { FolderEvent, WorkspaceContext } from "../WorkspaceContext";
import { activateInlayHints } from "./inlayHints";

/** Manages the creation and destruction of Language clients as we move between
 * workspace folders
 */
export class LanguageClientManager {
    private observeFoldersDisposable: vscode.Disposable;
    /** current running client */
    public languageClient?: langclient.LanguageClient;
    private inlayHints?: vscode.Disposable;
    private supportsDidChangedWatchedFiles: boolean;

    constructor(workspaceContext: WorkspaceContext) {
        // stop and start server for each folder based on which file I am looking at
        this.observeFoldersDisposable = workspaceContext.observeFolders(
            async (folderContext, event) => {
                switch (event) {
                    case FolderEvent.focus:
                        await this.setupLanguageClient(folderContext.folder);
                        break;
                    case FolderEvent.unfocus:
                        this.inlayHints?.dispose();
                        this.inlayHints = undefined;
                        if (this.languageClient) {
                            const client = this.languageClient;
                            this.languageClient = undefined;
                            client.stop();
                        }
                        break;
                }
            }
        );
        this.supportsDidChangedWatchedFiles = false;
    }

    dispose() {
        this.observeFoldersDisposable.dispose();
        this.inlayHints?.dispose();
        this.languageClient?.stop();
    }

    private async setupLanguageClient(folder: vscode.WorkspaceFolder) {
        const client = await this.createLSPClient(folder);
        client.start();

        console.log(`SourceKit-LSP setup for ${folder.name}`);

        this.supportsDidChangedWatchedFiles = false;
        this.languageClient = client;

        client.onReady().then(() => {
            this.inlayHints = activateInlayHints(client);
            /*            client.onRequest(langclient.RegistrationRequest.type, request => {
                console.log(p);
                const index = request.registrations.findIndex(
                    value => value.method === "workspace/didChangeWatchedFiles"
                );
                if (index !== -1) {
                    console.log("LSP Server supports workspace/didChangeWatchedFiles");
                    this.supportsDidChangedWatchedFiles = true;
                }
            });*/
        });
    }

    private async createLSPClient(
        folder: vscode.WorkspaceFolder
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
            // all the other LSP extensions have this in the form
            // {scheme: "file", language: "swift"}. Need to work out how this
            // is meant to work
            documentSelector: ["swift", "cpp", "c", "objective-c", "objective-cpp"],
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
