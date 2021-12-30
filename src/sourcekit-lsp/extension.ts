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
import { getSwiftExecutable } from "../utilities";
import { WorkspaceContext } from "../WorkspaceContext";
//import { activateInlayHints } from "./inlayHints";

/** Manages the creation and destruction of Language clients as we move between
 * workspace folders
 */
export class LanguageClientManager {
    private observeFoldersDisposable: vscode.Disposable;
    /** current running client */
    private languageClient?: langclient.LanguageClient;

    constructor(workspaceContext: WorkspaceContext) {
        // stop and start server for each folder based on which file I am looking at
        this.observeFoldersDisposable = workspaceContext.observeFolders(
            async (folderContext, event) => {
                switch (event) {
                    case "focus":
                        this.languageClient = await this.setupLanguageClient(folderContext.folder);
                        break;
                    case "unfocus":
                        await this.languageClient?.stop();
                        this.languageClient = undefined;
                        break;
                }
            }
        );
    }

    dispose() {
        this.observeFoldersDisposable.dispose();
        this.languageClient?.stop();
    }

    async setupLanguageClient(folder: vscode.WorkspaceFolder): Promise<langclient.LanguageClient> {
        const client = await this.createLSPClient(folder);
        client.start();

        console.log(`SourceKit-LSP setup for ${folder.name}`);

        return client;
    }

    async createLSPClient(folder: vscode.WorkspaceFolder): Promise<langclient.LanguageClient> {
        const config = vscode.workspace.getConfiguration("sourcekit-lsp");

        const sourcekit: langclient.Executable = {
            command: getSwiftExecutable("sourcekit-lsp"),
            args: config.get<string[]>("serverArguments", []),
        };

        const toolchain = config.get<string>("toolchainPath", "");
        if (toolchain) {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            sourcekit.options = { env: { ...process.env, SOURCEKIT_TOOLCHAIN_PATH: toolchain } };
        }

        const serverOptions: langclient.ServerOptions = sourcekit;

        const clientOptions: langclient.LanguageClientOptions = {
            documentSelector: ["swift", "cpp", "c", "objective-c", "objective-cpp"],
            synchronize: undefined,
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
