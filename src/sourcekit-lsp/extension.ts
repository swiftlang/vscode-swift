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

        const serverPathConfig = config.get<string>("serverPath", "");
        const serverPath =
            serverPathConfig.length > 0 ? serverPathConfig : getSwiftExecutable("sourcekit-lsp");
        const sourcekit: langclient.Executable = {
            command: serverPath,
            args: config.get<string[]>("serverArguments", []),
        };

        const toolchain = config.get<string>("toolchainPath", "");
        if (toolchain) {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            sourcekit.options = { env: { ...process.env, SOURCEKIT_TOOLCHAIN_PATH: toolchain } };
        }

        const serverOptions: langclient.ServerOptions = sourcekit;

        const clientOptions: langclient.LanguageClientOptions = {
            // all the other LSP extensions have this in the form
            // {scheme: "file", language: "swift"}. Need to work out how this
            // is meant to work
            documentSelector: ["swift", "cpp", "c", "objective-c", "objective-cpp"],
            synchronize: {
                // Notify the server about file changes in the workspace
                fileEvents: vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(folder, "**/*.swift")
                ),
            },
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
