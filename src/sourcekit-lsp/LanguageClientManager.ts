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

import * as vscode from "vscode";
import * as langclient from "vscode-languageclient/node";
import configuration from "../configuration";
import {
    ArgumentFilter,
    filterArguments,
    getSwiftExecutable,
    isPathInsidePath,
    swiftDriverSDKFlags,
    buildPathFlags,
    swiftRuntimeEnv,
} from "../utilities/utilities";
import { Version } from "../utilities/version";
import { FolderEvent, WorkspaceContext } from "../WorkspaceContext";
import { activateInlayHints } from "./inlayHints";
import { FolderContext } from "../FolderContext";

/** Manages the creation and destruction of Language clients as we move between
 * workspace folders
 */
export class LanguageClientManager {
    // document selector used by language client
    static documentSelector = [
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
    ];
    // build argument to sourcekit-lsp filter
    static buildArgumentFilter: ArgumentFilter[] = [
        { argument: "--build-path", include: 1 },
        { argument: "-Xswiftc", include: 1 },
        { argument: "-Xcc", include: 1 },
        { argument: "-Xcxx", include: 1 },
        { argument: "-Xlinker", include: 1 },
        { argument: "-Xclangd", include: 1 },
        { argument: "-index-store-path", include: 1 },
    ];

    /**
     * current running client
     *
     * undefined means not setup
     * null means in the process of restarting
     */
    private languageClient: langclient.LanguageClient | null | undefined;
    private cancellationToken?: vscode.CancellationTokenSource;
    private observeFoldersDisposable: vscode.Disposable;
    private onDidCreateFileDisposable: vscode.Disposable;
    private onDidDeleteFileDisposable: vscode.Disposable;
    private onChangeConfig: vscode.Disposable;
    private inlayHints?: vscode.Disposable;
    private supportsDidChangedWatchedFiles: boolean;
    private restartedPromise?: Promise<void>;
    private currentWorkspaceFolder?: vscode.Uri;
    private waitingOnRestartCount: number;
    private clientReadyPromise?: Promise<void>;
    public documentSymbolWatcher?: (
        document: vscode.TextDocument,
        symbols: vscode.DocumentSymbol[] | null | undefined
    ) => void;

    constructor(public workspaceContext: WorkspaceContext) {
        // stop and start server for each folder based on which file I am looking at
        this.observeFoldersDisposable = workspaceContext.observeFolders(
            async (folderContext, event) => {
                switch (event) {
                    case FolderEvent.add:
                        if (folderContext && folderContext.folder) {
                            // if active document is inside folder then setup language client
                            if (this.isActiveFileInFolder(folderContext.folder)) {
                                await this.setLanguageClientFolder(folderContext.folder);
                            }
                        }
                        break;
                    case FolderEvent.focus:
                        await this.setLanguageClientFolder(folderContext?.folder);
                        break;
                }
            }
        );
        // restart LSP server on creation of a new file
        this.onDidCreateFileDisposable = vscode.workspace.onDidCreateFiles(() => {
            if (!this.supportsDidChangedWatchedFiles) {
                this.restartLanguageClient();
            }
        });
        // restart LSP server on deletion of a file
        this.onDidDeleteFileDisposable = vscode.workspace.onDidDeleteFiles(() => {
            if (!this.supportsDidChangedWatchedFiles) {
                this.restartLanguageClient();
            }
        });
        // on change config restart server
        this.onChangeConfig = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("sourcekit-lsp.serverPath")) {
                vscode.window
                    .showInformationMessage(
                        "Changing LSP server path requires the language server be restarted.",
                        "Ok"
                    )
                    .then(selected => {
                        if (selected === "Ok") {
                            this.restartLanguageClient();
                        }
                    });
            }
        });

        // if we are running swift 5.6 or greater then LSP supports `didChangeWatchedFiles` message
        this.supportsDidChangedWatchedFiles = workspaceContext.swiftVersion.isGreaterThanOrEqual(
            new Version(5, 6, 0)
        );

        this.waitingOnRestartCount = 0;
        this.documentSymbolWatcher = undefined;
        this.cancellationToken = new vscode.CancellationTokenSource();
    }

    dispose() {
        this.cancellationToken?.cancel();
        this.cancellationToken?.dispose();
        this.observeFoldersDisposable.dispose();
        this.onDidCreateFileDisposable?.dispose();
        this.onDidDeleteFileDisposable?.dispose();
        this.onChangeConfig.dispose();
        this.inlayHints?.dispose();
        this.languageClient?.stop();
    }

    /** Set folder for LSP server
     *
     * If server is already running then check if the workspace folder is the same if
     * it isn't then restart the server using the new workspace folder.
     */
    async setLanguageClientFolder(uri?: vscode.Uri, forceRestart = false) {
        if (this.languageClient === undefined) {
            this.currentWorkspaceFolder = uri;
            this.restartedPromise = this.setupLanguageClient(uri);
            return;
        } else {
            if (uri === undefined || (this.currentWorkspaceFolder === uri && !forceRestart)) {
                return;
            }
            // count number of setLanguageClientFolder calls waiting on startedPromise
            this.waitingOnRestartCount += 1;
            // if in the middle of a restart then we have to wait until that
            // restart has finished
            if (this.restartedPromise) {
                try {
                    await this.restartedPromise;
                } catch (error) {
                    //ignore error
                }
            }
            this.waitingOnRestartCount -= 1;
            // only continue if no more calls are waiting on startedPromise
            if (this.waitingOnRestartCount !== 0) {
                return;
            }

            const client = this.languageClient;
            // language client is set to null while it is in the process of restarting
            this.languageClient = null;
            this.currentWorkspaceFolder = uri;
            this.inlayHints?.dispose();
            this.inlayHints = undefined;
            if (client) {
                this.cancellationToken?.cancel();
                this.cancellationToken?.dispose();
                this.restartedPromise = client
                    .stop()
                    .then(async () => {
                        await this.setupLanguageClient(uri);
                    })
                    .catch(reason => {
                        this.workspaceContext.outputChannel.log(`${reason}`);
                    });
            }
        }
    }

    /** workspace folder of current client */
    get workspaceFolder(): vscode.Uri | undefined {
        return this.languageClient?.clientOptions?.workspaceFolder?.uri;
    }

    /**
     * Use language client safely. Provides a cancellation token to the function
     * which can be used to safely ensure language client request are cancelled
     * if the language is shutdown.
     * @param process process using language client
     * @returns result of process
     */
    async useLanguageClient<Return>(process: {
        (client: langclient.LanguageClient, cancellationToken: vscode.CancellationToken): Return;
    }) {
        if (!this.languageClient) {
            throw LanguageClientError.LanguageClientUnavailable;
        }
        return await this.clientReadyPromise?.then(() => {
            if (!this.languageClient || !this.cancellationToken) {
                throw LanguageClientError.LanguageClientUnavailable;
            }
            return process(this.languageClient, this.cancellationToken.token);
        });
    }

    /** Restart language client */
    async restartLanguageClient() {
        // force restart of language client
        await this.setLanguageClientFolder(this.currentWorkspaceFolder, true);
    }

    private isActiveFileInFolder(uri: vscode.Uri): boolean {
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document) {
            // if active document is inside folder then setup language client
            const activeDocPath = vscode.window.activeTextEditor.document.uri.fsPath;
            if (isPathInsidePath(activeDocPath, uri.fsPath)) {
                return true;
            }
        }
        return false;
    }

    private setupLanguageClient(folder?: vscode.Uri): Promise<void> {
        const client = this.createLSPClient(folder);
        return this.startClient(client);
    }

    private createLSPClient(folder?: vscode.Uri): langclient.LanguageClient {
        const lspConfig = configuration.lsp;
        const serverPathConfig = lspConfig.serverPath;
        const serverPath =
            serverPathConfig.length > 0 ? serverPathConfig : getSwiftExecutable("sourcekit-lsp");
        const sdkArguments = [
            ...swiftDriverSDKFlags(true),
            ...filterArguments(
                configuration.buildArguments.concat(buildPathFlags()),
                LanguageClientManager.buildArgumentFilter
            ),
        ];

        const sourcekit: langclient.Executable = {
            command: serverPath,
            args: lspConfig.serverArguments.concat(sdkArguments),
            options: {
                env: {
                    ...process.env,
                    ...configuration.swiftEnvironmentVariables,
                    ...swiftRuntimeEnv(),
                },
            },
        };

        // if path to LSP server is not equal to the path to swift and both are set, then
        // pass swift toolchain to the LSP server
        if (
            serverPathConfig.length > 0 &&
            configuration.path.length > 0 &&
            serverPathConfig !== getSwiftExecutable("sourcekit-lsp")
        ) {
            // if configuration has custom swift path then set toolchain path
            if (configuration.path) {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                sourcekit.options = {
                    env: {
                        ...sourcekit.options?.env,
                        SOURCEKIT_TOOLCHAIN_PATH: this.workspaceContext.toolchain.toolchainPath,
                    },
                };
            }
        }

        const serverOptions: langclient.ServerOptions = sourcekit;
        let workspaceFolder = undefined;
        if (folder) {
            workspaceFolder = { uri: folder, name: FolderContext.uriName(folder), index: 0 };
        }
        const clientOptions: langclient.LanguageClientOptions = {
            documentSelector: LanguageClientManager.documentSelector,
            revealOutputChannelOn: langclient.RevealOutputChannelOn.Never,
            workspaceFolder: workspaceFolder,
            middleware: {
                provideDocumentSymbols: async (document, token, next) => {
                    const result = await next(document, token);
                    const documentSymbols = result as vscode.DocumentSymbol[];
                    if (this.documentSymbolWatcher && documentSymbols) {
                        this.documentSymbolWatcher(document, documentSymbols);
                    }
                    return result;
                },
            },
        };

        return new langclient.LanguageClient(
            "sourcekit-lsp",
            "SourceKit Language Server",
            serverOptions,
            clientOptions
        );
    }

    private startClient(client: langclient.LanguageClient): Promise<void> {
        if (client.clientOptions.workspaceFolder) {
            this.workspaceContext.outputChannel.log(
                `SourceKit-LSP setup for ${FolderContext.uriName(
                    client.clientOptions.workspaceFolder.uri
                )}`
            );
        } else {
            this.workspaceContext.outputChannel.log(`SourceKit-LSP setup`);
        }

        // start client
        this.clientReadyPromise = client
            .start()
            .then(() => {
                this.inlayHints = activateInlayHints(client);
            })
            .catch(reason => {
                this.workspaceContext.outputChannel.log(`${reason}`);
                // if language client failed to initialise then shutdown and set to undefined
                this.languageClient?.stop();
                this.languageClient = undefined;
                throw reason;
            });

        this.languageClient = client;
        this.cancellationToken = new vscode.CancellationTokenSource();

        return this.clientReadyPromise;
    }
}

/** Language client errors */
export enum LanguageClientError {
    LanguageClientUnavailable,
}
