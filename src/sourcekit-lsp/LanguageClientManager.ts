//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import {
    CloseAction,
    CloseHandlerResult,
    DidChangeWorkspaceFoldersNotification,
    ErrorAction,
    ErrorHandler,
    ErrorHandlerResult,
    LanguageClientOptions,
    Message,
    MessageType,
    State,
} from "vscode-languageclient";
import configuration from "../configuration";
import { swiftRuntimeEnv } from "../utilities/utilities";
import { Version } from "../utilities/version";
import { activateLegacyInlayHints } from "./inlayHints";
import { activatePeekDocuments } from "./peekDocuments";
import { FolderContext } from "../FolderContext";
import { Executable, LanguageClient, ServerOptions } from "vscode-languageclient/node";
import { ArgumentFilter, BuildFlags } from "../toolchain/BuildFlags";
import { LSPLogger, LSPOutputChannel } from "./LSPOutputChannel";
import { activateGetReferenceDocument } from "./getReferenceDocument";
import { LanguageClientFactory } from "./LanguageClientFactory";
import { SourceKitLogMessageNotification, SourceKitLogMessageParams } from "./extensions";
import { LSPActiveDocumentManager } from "./didChangeActiveDocument";
import { DidChangeActiveDocumentNotification } from "./extensions/DidChangeActiveDocumentRequest";
import { lspClientOptions } from "./LanguageClientConfiguration";
import { SwiftOutputChannel } from "../logging/SwiftOutputChannel";

interface LanguageClientManageOptions {
    /**
     * Options for the LanguageClientManager
     */
    onDocumentSymbols?: (
        folder: FolderContext,
        document: vscode.TextDocument,
        symbols: vscode.DocumentSymbol[] | null | undefined
    ) => void;
}

/**
 * Manages the creation and destruction of Language clients as we move between
 * workspace folders
 */
export class LanguageClientManager implements vscode.Disposable {
    // known log names
    static indexingLogName = "SourceKit-LSP: Indexing";

    // build argument to sourcekit-lsp filter
    static buildArgumentFilter: ArgumentFilter[] = [
        { argument: "--build-path", include: 1 },
        { argument: "--scratch-path", include: 1 },
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
    private languageClient: LanguageClient | null | undefined;
    private cancellationToken?: vscode.CancellationTokenSource;
    private legacyInlayHints?: vscode.Disposable;
    private peekDocuments?: vscode.Disposable;
    private getReferenceDocument?: vscode.Disposable;
    private didChangeActiveDocument?: vscode.Disposable;
    private restartedPromise?: Promise<void>;
    private currentWorkspaceFolder?: FolderContext;
    private waitingOnRestartCount: number;
    private clientReadyPromise?: Promise<void>;
    public documentSymbolWatcher?: (
        document: vscode.TextDocument,
        symbols: vscode.DocumentSymbol[] | null | undefined
    ) => void;
    private subscriptions: vscode.Disposable[];
    private singleServerSupport: boolean;
    // used by single server support to keep a record of the project folders
    // that are not at the root of their workspace
    public subFolderWorkspaces: FolderContext[] = [];
    private addedFolders: FolderContext[] = [];
    private namedOutputChannels: Map<string, LSPOutputChannel> = new Map();
    private swiftVersion: Version;
    private activeDocumentManager = new LSPActiveDocumentManager();

    /** Get the current state of the underlying LanguageClient */
    public get state(): State {
        if (!this.languageClient) {
            return State.Stopped;
        }
        return this.languageClient.state;
    }

    constructor(
        public folderContext: FolderContext,
        private options: LanguageClientManageOptions = {},
        private languageClientFactory: LanguageClientFactory = new LanguageClientFactory()
    ) {
        this.namedOutputChannels.set(
            LanguageClientManager.indexingLogName,
            new LSPOutputChannel(LanguageClientManager.indexingLogName, false, true)
        );
        this.swiftVersion = folderContext.swiftVersion;
        this.singleServerSupport = this.swiftVersion.isGreaterThanOrEqual(new Version(5, 7, 0));
        this.subscriptions = [];

        // on change config restart server
        const onChangeConfig = vscode.workspace.onDidChangeConfiguration(event => {
            if (!event.affectsConfiguration("swift.sourcekit-lsp")) {
                return;
            }
            let message =
                "Changing SourceKit-LSP settings requires the language server be restarted. Would you like to restart it now?";
            let restartLSPButton = "Restart Language Server";
            // Enabling/Disabling sourcekit-lsp shows a special notification
            if (event.affectsConfiguration("swift.sourcekit-lsp.disable")) {
                if (configuration.lsp.disable) {
                    if (this.state === State.Stopped) {
                        // Language client is already stopped
                        return;
                    }
                    message = `You have disabled the Swift language server, but it is still running. Would you like to stop it now?
                        This will turn off features such as code completion, error diagnostics, jump-to-definition, and test discovery.`;
                    restartLSPButton = "Stop Language Server";
                } else {
                    if (this.state !== State.Stopped) {
                        // Langauge client is already running
                        return;
                    }
                    message =
                        "You have enabled the Swift language server. Would you like to start it now?";
                    restartLSPButton = "Start Language Server";
                }
            } else if (configuration.lsp.disable && this.state === State.Stopped) {
                // Ignore configuration changes if SourceKit-LSP is disabled
                return;
            }
            void vscode.window.showInformationMessage(message, restartLSPButton).then(selected => {
                if (selected === restartLSPButton) {
                    void this.restart();
                }
            });
        });

        this.subscriptions.push(onChangeConfig);

        // Swift versions prior to 5.6 don't support file changes, so need to restart
        // lSP server when a file is either created or deleted
        if (this.swiftVersion.isLessThan(new Version(5, 6, 0))) {
            folderContext.workspaceContext.logger.debug("LSP: Adding new/delete file handlers");
            // restart LSP server on creation of a new file
            const onDidCreateFileDisposable = vscode.workspace.onDidCreateFiles(() => {
                void this.restart();
            });
            // restart LSP server on deletion of a file
            const onDidDeleteFileDisposable = vscode.workspace.onDidDeleteFiles(() => {
                void this.restart();
            });
            this.subscriptions.push(onDidCreateFileDisposable, onDidDeleteFileDisposable);
        }

        this.waitingOnRestartCount = 0;
        this.documentSymbolWatcher = undefined;
        this.cancellationToken = new vscode.CancellationTokenSource();
    }

    // The language client stops asnyhronously, so we need to wait for it to stop
    // instead of doing it in dispose, which must be synchronous.
    async stop(dispose: boolean = true) {
        if (this.languageClient && this.languageClient.state === State.Running) {
            await this.languageClient.stop(15000);
            if (dispose) {
                await this.languageClient.dispose();
            }
        }
    }

    dispose() {
        this.cancellationToken?.cancel();
        this.cancellationToken?.dispose();
        this.legacyInlayHints?.dispose();
        this.peekDocuments?.dispose();
        this.getReferenceDocument?.dispose();
        this.subscriptions.forEach(item => item.dispose());
        this.namedOutputChannels.forEach(channel => channel.dispose());
    }

    /**
     * Use language client safely. Provides a cancellation token to the function
     * which can be used to safely ensure language client request are cancelled
     * if the language is shutdown.
     * @param process process using language client
     * @returns result of process
     */
    async useLanguageClient<Return>(process: {
        (client: LanguageClient, cancellationToken: vscode.CancellationToken): Promise<Return>;
    }): Promise<Return> {
        if (!this.languageClient || !this.clientReadyPromise) {
            throw new Error(LanguageClientError.LanguageClientUnavailable);
        }
        return this.clientReadyPromise.then(
            () => {
                if (!this.languageClient || !this.cancellationToken) {
                    throw new Error(LanguageClientError.LanguageClientUnavailable);
                }
                return process(this.languageClient, this.cancellationToken.token);
            },
            reason => reason
        );
    }

    /** Restart language client */
    async restart() {
        // force restart of language client
        await this.setLanguageClientFolder(this.folderContext, true);
    }

    get languageClientOutputChannel(): SwiftOutputChannel | undefined {
        return this.languageClient?.outputChannel as SwiftOutputChannel | undefined;
    }

    async addFolder(folderContext: FolderContext) {
        if (!folderContext.isRootFolder) {
            await this.useLanguageClient(async client => {
                this.subFolderWorkspaces.push(folderContext);

                const uri = folderContext.folder;
                const workspaceFolder = {
                    uri: client.code2ProtocolConverter.asUri(uri),
                    name: FolderContext.uriName(uri),
                };
                await client.sendNotification(DidChangeWorkspaceFoldersNotification.type, {
                    event: { added: [workspaceFolder], removed: [] },
                });
            });
        }
        this.addedFolders.push(folderContext);
    }

    async removeFolder(folderContext: FolderContext) {
        if (!folderContext.isRootFolder) {
            await this.useLanguageClient(async client => {
                const uri = folderContext.folder;
                this.subFolderWorkspaces = this.subFolderWorkspaces.filter(
                    item => item.folder !== uri
                );

                const workspaceFolder = {
                    uri: client.code2ProtocolConverter.asUri(uri),
                    name: FolderContext.uriName(uri),
                };
                await client.sendNotification(DidChangeWorkspaceFoldersNotification.type, {
                    event: { added: [], removed: [workspaceFolder] },
                });
            });
        }
        this.addedFolders = this.addedFolders.filter(item => item.folder !== folderContext.folder);
    }

    private async addSubFolderWorkspaces(client: LanguageClient) {
        for (const folderContext of this.subFolderWorkspaces) {
            const workspaceFolder = {
                uri: client.code2ProtocolConverter.asUri(folderContext.folder),
                name: FolderContext.uriName(folderContext.folder),
            };
            await client.sendNotification(DidChangeWorkspaceFoldersNotification.type, {
                event: { added: [workspaceFolder], removed: [] },
            });
        }
    }

    /**
     * Set folder for LSP server.
     * If server is already running then check if the workspace folder is the same if
     * it isn't then restart the server using the new workspace folder.
     */
    async setLanguageClientFolder(folder: FolderContext, forceRestart = false) {
        const uri = folder.folder;
        if (this.languageClient === undefined) {
            this.currentWorkspaceFolder = folder;
            this.restartedPromise = this.setupLanguageClient(folder);
            return;
        } else {
            // don't check for undefined uri's or if the current workspace is the same if we are
            // running a single server. The only way we can get here while using a single server
            // is when restart is called.
            if (!this.singleServerSupport) {
                if (this.currentWorkspaceFolder?.folder === uri && !forceRestart) {
                    return;
                }
            }
            await this.restartLanguageClient(folder);
        }
    }

    /**
     * Restart language client using supplied workspace folder
     * @param workspaceFolder workspace folder to send to server
     * @returns when done
     */
    private async restartLanguageClient(workspaceFolder: FolderContext) {
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
        this.currentWorkspaceFolder = workspaceFolder;
        this.legacyInlayHints?.dispose();
        this.legacyInlayHints = undefined;
        this.peekDocuments?.dispose();
        this.peekDocuments = undefined;
        this.getReferenceDocument?.dispose();
        this.getReferenceDocument = undefined;
        if (client) {
            this.cancellationToken?.cancel();
            this.cancellationToken?.dispose();
            this.restartedPromise = client
                .stop()
                .then(async () => {
                    await this.setupLanguageClient(workspaceFolder);

                    // Now that the client has been replaced, dispose the old client's output channel.
                    client.outputChannel.dispose();
                })
                .catch(async reason => {
                    // error message matches code here https://github.com/microsoft/vscode-languageserver-node/blob/2041784436fed53f4e77267a49396bca22a7aacf/client/src/common/client.ts#L1409C1-L1409C54
                    if (reason.message === "Stopping the server timed out") {
                        await this.setupLanguageClient(workspaceFolder);
                    }
                    this.folderContext.workspaceContext.logger.error(reason);
                });
            await this.restartedPromise;
        }
    }

    private async setupLanguageClient(folder: FolderContext) {
        if (configuration.lsp.disable) {
            this.languageClient = undefined;
            return;
        }
        const { client, errorHandler } = this.createLSPClient(folder);
        return this.startClient(client, errorHandler);
    }

    private createLSPClient(folder: FolderContext): {
        client: LanguageClient;
        errorHandler: SourceKitLSPErrorHandler;
    } {
        const toolchain = folder.toolchain;
        const toolchainSourceKitLSP = toolchain.getToolchainExecutable("sourcekit-lsp");
        const lspConfig = configuration.lsp;
        const serverPathConfig = lspConfig.serverPath;
        const serverPath = serverPathConfig.length > 0 ? serverPathConfig : toolchainSourceKitLSP;
        const buildFlags = toolchain.buildFlags;
        const sdkArguments = [
            ...buildFlags.swiftDriverSDKFlags(true),
            ...buildFlags.swiftDriverTargetFlags(true),
            ...BuildFlags.filterArguments(
                configuration.buildArguments.concat(buildFlags.buildPathFlags()),
                LanguageClientManager.buildArgumentFilter
            ),
        ];

        const sourcekit: Executable = {
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
            serverPathConfig !== toolchainSourceKitLSP
        ) {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            sourcekit.options = {
                env: {
                    ...sourcekit.options?.env,
                    SOURCEKIT_TOOLCHAIN_PATH: toolchain.toolchainPath,
                },
            };
        }

        const serverOptions: ServerOptions = sourcekit;
        let workspaceFolder = undefined;
        if (folder && !this.singleServerSupport) {
            workspaceFolder = {
                uri: folder.folder,
                name: FolderContext.uriName(folder.folder),
                index: 0,
            };
        }

        const errorHandler = new SourceKitLSPErrorHandler(5);
        const clientOptions: LanguageClientOptions = lspClientOptions(
            this.swiftVersion,
            this.folderContext.workspaceContext,
            workspaceFolder,
            this.activeDocumentManager,
            errorHandler,
            (document, symbols) => {
                const documentFolderContext = [this.folderContext, ...this.addedFolders].find(
                    folderContext => document.uri.fsPath.startsWith(folderContext.folder.fsPath)
                );
                if (!documentFolderContext) {
                    this.languageClientOutputChannel?.warn(
                        "Unable to find folder for document: " + document.uri.fsPath
                    );
                    return;
                }
                this.options.onDocumentSymbols?.(documentFolderContext, document, symbols);
            }
        );

        return {
            client: this.languageClientFactory.createLanguageClient(
                "swift.sourcekit-lsp",
                `SourceKit Language Server (${this.folderContext.toolchain.swiftVersion.toString()})`,
                serverOptions,
                clientOptions
            ),
            errorHandler,
        };
    }

    private async startClient(client: LanguageClient, errorHandler: SourceKitLSPErrorHandler) {
        const runningPromise = new Promise<void>((res, rej) => {
            const disposable = client.onDidChangeState(e => {
                // if state is now running add in any sub-folder workspaces that
                // we have cached. If this is the first time we are starting then
                // we won't have any sub folder workspaces, but if the server crashed
                // or we forced a restart then we need to do this
                if (e.oldState === State.Starting && e.newState === State.Running) {
                    res();
                    disposable.dispose();
                    void this.addSubFolderWorkspaces(client);
                } else if (e.oldState === State.Starting && e.newState === State.Stopped) {
                    rej("SourceKit-LSP failed to start");
                    disposable.dispose();
                }
            });
        });
        if (client.clientOptions.workspaceFolder) {
            this.folderContext.workspaceContext.logger.info(
                `SourceKit-LSP setup for ${FolderContext.uriName(
                    client.clientOptions.workspaceFolder.uri
                )}`
            );
        } else {
            this.folderContext.workspaceContext.logger.info(`SourceKit-LSP setup`);
        }

        client.onNotification(SourceKitLogMessageNotification.type, params => {
            this.logMessage(client, params as SourceKitLogMessageParams);
        });

        // start client
        this.clientReadyPromise = client
            .start()
            .then(() => runningPromise)
            .then(() => {
                // Now that we've started up correctly, start the error handler to auto-restart
                // if sourcekit-lsp crashes during normal operation.
                errorHandler.enable();

                if (this.swiftVersion.isLessThan(new Version(5, 7, 0))) {
                    this.legacyInlayHints = activateLegacyInlayHints(client);
                }

                this.peekDocuments = activatePeekDocuments(client);
                this.getReferenceDocument = activateGetReferenceDocument(client);
                this.subscriptions.push(this.getReferenceDocument);
                try {
                    if (
                        checkExperimentalCapability(
                            client,
                            DidChangeActiveDocumentNotification.method,
                            1
                        )
                    ) {
                        this.didChangeActiveDocument =
                            this.activeDocumentManager.activateDidChangeActiveDocument(client);
                        this.subscriptions.push(this.didChangeActiveDocument);
                    }
                } catch {
                    // do nothing
                }
            })
            .catch(reason => {
                this.folderContext.workspaceContext.logger.error(reason);
                void this.languageClient?.stop();
                this.languageClient = undefined;
                throw reason;
            });

        this.languageClient = client;
        this.cancellationToken = new vscode.CancellationTokenSource();

        return this.clientReadyPromise;
    }

    private logMessage(client: LanguageClient, params: SourceKitLogMessageParams) {
        let logger: LSPLogger = client;
        if (params.logName) {
            const outputChannel =
                this.namedOutputChannels.get(params.logName) ??
                new LSPOutputChannel(params.logName);
            this.namedOutputChannels.set(params.logName, outputChannel);
            logger = outputChannel;
        }
        switch (params.type) {
            case MessageType.Info:
                logger.info(params.message);
                break;
            case MessageType.Debug:
                logger.debug(params.message);
                break;
            case MessageType.Warning:
                logger.warn(params.message);
                break;
            case MessageType.Error:
                logger.error(params.message);
                break;
            case MessageType.Log:
                logger.info(params.message);
                break;
        }
    }
}

/**
 * SourceKit-LSP error handler. Copy of the default error handler, except it includes
 * an error message that asks if you want to restart the sourcekit-lsp server again
 * after so many crashes
 */
export class SourceKitLSPErrorHandler implements ErrorHandler {
    private restarts: number[];
    private enabled: boolean = false;

    constructor(private maxRestartCount: number) {
        this.restarts = [];
    }
    /**
     * Start listening for errors and requesting to restart the LSP server when appropriate.
     */
    enable() {
        this.enabled = true;
    }
    /**
     * An error has occurred while writing or reading from the connection.
     *
     * @param _error - the error received
     * @param _message - the message to be delivered to the server if know.
     * @param count - a count indicating how often an error is received. Will
     *  be reset if a message got successfully send or received.
     */
    error(
        _error: Error,
        _message: Message | undefined,
        count: number | undefined
    ): ErrorHandlerResult | Promise<ErrorHandlerResult> {
        if (count && count <= 3) {
            return { action: ErrorAction.Continue };
        }
        return { action: ErrorAction.Shutdown };
    }
    /**
     * The connection to the server got closed.
     */
    closed(): CloseHandlerResult | Promise<CloseHandlerResult> {
        if (!this.enabled) {
            return {
                action: CloseAction.DoNotRestart,
                handled: true,
            };
        }

        this.restarts.push(Date.now());
        if (this.restarts.length <= this.maxRestartCount) {
            return { action: CloseAction.Restart };
        } else {
            const diff = this.restarts[this.restarts.length - 1] - this.restarts[0];
            if (diff <= 3 * 60 * 1000) {
                return new Promise<CloseHandlerResult>(resolve => {
                    void vscode.window
                        .showErrorMessage(
                            `The SourceKit-LSP server crashed ${
                                this.maxRestartCount + 1
                            } times in the last 3 minutes. See the output for more information. Do you want to restart it again.`,
                            "Yes",
                            "No"
                        )
                        .then(result => {
                            if (result === "Yes") {
                                this.restarts = [];
                                resolve({ action: CloseAction.Restart });
                            } else {
                                resolve({ action: CloseAction.DoNotRestart });
                            }
                        });
                });
            } else {
                this.restarts.shift();
                return { action: CloseAction.Restart };
            }
        }
    }
}

/** Language client errors */
export const enum LanguageClientError {
    LanguageClientUnavailable = "Language Client Unavailable",
}

/**
 * Returns `true` if the LSP supports the supplied `method` at or
 * above the supplied `minVersion`.
 */
export function checkExperimentalCapability(
    client: LanguageClient,
    method: string,
    minVersion: number
) {
    const experimentalCapability = client.initializeResult?.capabilities.experimental;
    if (!experimentalCapability) {
        throw new Error(`${method} requests not supported`);
    }
    const targetCapability = experimentalCapability[method];
    return (targetCapability?.version ?? -1) >= minVersion;
}
