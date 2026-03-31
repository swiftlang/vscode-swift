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
import { Executable, LanguageClient, ServerOptions } from "vscode-languageclient/node";

import { FolderContext } from "../FolderContext";
import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { SwiftOutputChannel } from "../logging/SwiftOutputChannel";
import { ArgumentFilter, BuildFlags } from "../toolchain/BuildFlags";
import { SwiftToolchain } from "../toolchain/toolchain";
import { Disposable } from "../utilities/Disposable";
import { swiftRuntimeEnv } from "../utilities/utilities";
import { Version } from "../utilities/version";
import { LSPLogger, LSPOutputChannel } from "./LSPOutputChannel";
import { lspClientOptions } from "./LanguageClientConfiguration";
import { LanguageClientFactory } from "./LanguageClientFactory";
import { WorkspaceFolderGate } from "./WorkspaceFolderGate";
import { LSPActiveDocumentManager } from "./didChangeActiveDocument";
import { SourceKitLogMessageNotification, SourceKitLogMessageParams } from "./extensions";
import { DidChangeActiveDocumentNotification } from "./extensions/DidChangeActiveDocumentRequest";
import { PollIndexRequest, WorkspaceSynchronizeRequest } from "./extensions/PollIndexRequest";
import { activateGetReferenceDocument } from "./getReferenceDocument";
import { activatePeekDocuments } from "./peekDocuments";

/**
 * Options for the LanguageClientManager
 */
interface LanguageClientManageOptions {
    onDocumentSymbols?: (
        folder: FolderContext,
        document: vscode.TextDocument,
        symbols: vscode.DocumentSymbol[] | null | undefined
    ) => void;

    onDocumentCodeLens?: (
        folder: FolderContext,
        document: vscode.TextDocument,
        codeLens: vscode.CodeLens[] | null | undefined
    ) => void;
}

/**
 * Manages the creation and destruction of Language clients as we move between
 * workspace folders
 */
export class LanguageClientManager implements Disposable {
    // known log names
    static readonly indexingLogName = "SourceKit-LSP: Indexing";

    // build argument to sourcekit-lsp filter
    static readonly buildArgumentFilter: ArgumentFilter[] = [
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
    private cancellationToken: vscode.CancellationTokenSource;
    private legacyInlayHints?: Disposable;
    private peekDocuments?: Disposable;
    private getReferenceDocument?: Disposable;
    private didChangeActiveDocument?: Disposable;
    private subscriptions: Disposable[] = [];
    private namedOutputChannels: Map<string, LSPOutputChannel> = new Map();
    private swiftVersion: Version;
    private activeDocumentManager = new LSPActiveDocumentManager();
    private logger: SwiftLogger;
    public addedFolders: FolderContext[] = [];

    public readonly folderGate: WorkspaceFolderGate;

    /** Get the current state of the underlying LanguageClient */
    public get state(): State {
        if (!this.languageClient) {
            return State.Stopped;
        }
        return this.languageClient.state;
    }

    /**
     * Creates a new LSP client.
     * @param folderContext
     * @param options
     * @param languageClientFactory
     * @returns LanguageClientManager with the LSP client already started and ready to use
     */
    public static async create(
        folderContext: FolderContext,
        options: LanguageClientManageOptions = {},
        languageClientFactory: LanguageClientFactory = new LanguageClientFactory()
    ) {
        const manager = new LanguageClientManager(folderContext, options, languageClientFactory);
        await manager.setupLanguageClient(folderContext, folderContext.toolchain);
        return manager;
    }

    private constructor(
        public folderContext: FolderContext,
        private options: LanguageClientManageOptions = {},
        private languageClientFactory: LanguageClientFactory = new LanguageClientFactory()
    ) {
        this.namedOutputChannels.set(
            LanguageClientManager.indexingLogName,
            new LSPOutputChannel(LanguageClientManager.indexingLogName, false, true)
        );
        this.logger = folderContext.logger;
        this.swiftVersion = folderContext.swiftVersion;
        this.cancellationToken = new vscode.CancellationTokenSource();
        this.folderGate = new WorkspaceFolderGate(folderContext.folder);

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
    }

    /**
     * Stops the LSP client if it is running.
     * If dispose is true then also dispose the client after stopping, otherwise leave it in a stopped state.
     * This is useful for when we want to restart the client, as we need to stop it first but we don't want to
     * dispose it until the extension is deactivated.
     * @param dispose Whether to dispose the client after stopping. Defaults to true.
     */
    public async stop(dispose: boolean = true) {
        if (!this.languageClient || this.languageClient.state !== State.Running) {
            return;
        }

        await this.languageClient.stop(15000);
        if (dispose) {
            await this.languageClient.dispose();
        }
    }

    /**
     * Use language client safely. Provides a cancellation token to the function
     * which can be used to safely ensure language client request are cancelled
     * if the language is shutdown.
     * @param process process using language client
     * @returns result of process
     */
    public async useLanguageClient<Return>(process: {
        (client: LanguageClient, cancellationToken: vscode.CancellationToken): Promise<Return>;
    }): Promise<Return> {
        if (!this.languageClient) {
            throw new Error(LanguageClientError.LanguageClientUnavailable);
        }
        return process(this.languageClient, this.cancellationToken.token);
    }

    /**
     * Restart the language client.
     */
    public async restart() {
        await this.restartLanguageClient(this.folderContext, this.folderContext.toolchain);
    }

    /**
     * Returns the path to the log file for the output channel of the language client, if it exists.
     */
    public get languageClientOutputChannelLogFilePath(): string | undefined {
        return this.languageClientOutputChannel?.logFilePath;
    }

    /**
     * Add a sub-folder to the language client.
     * For multi-root workspaces the root folder may contain several swift packages.
     * Each of these swift package folders should be added via addFolder to ensure they are
     * indexed by the language server.
     * @param folderContext The folder to add
     */
    public async addFolder(folderContext: FolderContext) {
        if (!folderContext.isRootFolder) {
            await this.useLanguageClient(async client => {
                const uri = folderContext.folder;
                const workspaceFolder = {
                    uri: client.code2ProtocolConverter.asUri(uri),
                    name: FolderContext.uriName(uri),
                };
                this.logger.info(`Adding folder ${uri.fsPath} to SourceKit-LSP workspace`);
                await client.sendNotification(DidChangeWorkspaceFoldersNotification.type, {
                    event: { added: [workspaceFolder], removed: [] },
                });
                this.folderGate.folderAdded(folderContext.folder);
            });
        }
        this.addedFolders.push(folderContext);
    }

    /**
     * Remove a sub-folder from the language client.
     * For multi-root workspaces the root folder may contain several swift packages.
     * Each of these swift package folders should be removed via removeFolder to ensure they are
     * no longer indexed by the language server.
     * @param folderContext The folder to remove
     */
    public async removeFolder(folderContext: FolderContext) {
        if (!folderContext.isRootFolder) {
            await this.useLanguageClient(async client => {
                const uri = folderContext.folder;
                const workspaceFolder = {
                    uri: client.code2ProtocolConverter.asUri(uri),
                    name: FolderContext.uriName(uri),
                };

                this.logger.info(`Removing folder ${uri.fsPath} from SourceKit-LSP workspace`);

                await client.sendNotification(DidChangeWorkspaceFoldersNotification.type, {
                    event: { added: [], removed: [workspaceFolder] },
                });
                this.folderGate.folderRemoved(folderContext.folder);
            });
        }
        this.addedFolders = this.addedFolders.filter(item => item.folder !== folderContext.folder);
    }

    /**
     * Wait for the LSP to indicate it is done indexing.
     */
    async waitForIndex(): Promise<void> {
        const requestType = this.swiftVersion.isGreaterThanOrEqual(new Version(6, 2, 0))
            ? WorkspaceSynchronizeRequest.type
            : PollIndexRequest.type;

        await this.useLanguageClient(async (client, token) =>
            client.sendRequest(
                requestType,
                requestType.method === WorkspaceSynchronizeRequest.type.method
                    ? { index: true }
                    : {},
                token
            )
        );
    }

    public dispose() {
        if (this.languageClient && this.languageClient.state === State.Running) {
            throw new Error(
                "LanguageClient is still running. Please call stop() and wait for it to finish before disposing."
            );
        }

        this.cancellationToken?.cancel();
        this.cancellationToken?.dispose();
        this.folderGate.dispose();
        this.legacyInlayHints?.dispose();
        this.peekDocuments?.dispose();
        this.getReferenceDocument?.dispose();
        this.subscriptions.forEach(item => item.dispose());
        this.namedOutputChannels.forEach(channel => channel.dispose());
    }

    /**
     * Restart language client using supplied workspace folder
     * @param workspaceFolder workspace folder to use for the new language client
     * @param toolchain toolchain to get new language client for
     * @returns when done
     */
    private async restartLanguageClient(folderContext: FolderContext, toolchain: SwiftToolchain) {
        const client = this.languageClient;
        // language client is set to null while it is in the process of restarting
        this.languageClient = null;
        this.legacyInlayHints?.dispose();
        this.legacyInlayHints = undefined;
        this.peekDocuments?.dispose();
        this.peekDocuments = undefined;
        this.getReferenceDocument?.dispose();
        this.getReferenceDocument = undefined;
        if (client) {
            this.cancellationToken?.cancel();
            this.cancellationToken?.dispose();

            try {
                await client.stop();

                // Dispose the old client's output channel before creating the
                // new client. The server process may still write to stderr after
                // stop() resolves. Disposing here sets isDisposed on the logger,
                // preventing late writes from entering the winston pipeline and
                // reaching a destroyed transport.
                client.outputChannel.dispose();

                await this.setupLanguageClient(folderContext, toolchain);
            } catch (reason: Error | unknown) {
                client.outputChannel.dispose();
                this.logger.error(
                    `Error starting SourceKit-LSP in restartLanguageClient: ${reason}`
                );
                // error message matches code here https://github.com/microsoft/vscode-languageserver-node/blob/2041784436fed53f4e77267a49396bca22a7aacf/client/src/common/client.ts#L1409C1-L1409C54
                if ((reason as Error).message === "Stopping the server timed out") {
                    try {
                        await this.setupLanguageClient(folderContext, toolchain);
                    } catch (reason) {
                        this.logger.error(
                            `Error starting SourceKit-LSP after server timeout in restartLanguageClient: ${reason}`
                        );
                    }
                }
                this.logger.error(reason);
            }
        }
    }

    private async setupLanguageClient(folderContext: FolderContext, toolchain: SwiftToolchain) {
        if (configuration.lsp.disable) {
            this.languageClient = undefined;
            return;
        }

        try {
            const { client, errorHandler } = this.createLSPClient(
                {
                    uri: folderContext.folder,
                    name: FolderContext.uriName(folderContext.folder),
                    index: 0,
                },
                toolchain
            );
            return await this.startClient(client, errorHandler);
        } catch (error) {
            this.logger.error(
                Error("Error starting SourceKit-LSP in initializeLanguageClient", {
                    cause: error,
                })
            );
        }
    }

    private createLSPClient(
        workspaceFolder: vscode.WorkspaceFolder | undefined,
        toolchain: SwiftToolchain
    ): {
        client: LanguageClient;
        errorHandler: SourceKitLSPErrorHandler;
    } {
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
            sourcekit.options = {
                env: {
                    ...sourcekit.options?.env,
                    SOURCEKIT_TOOLCHAIN_PATH: toolchain.toolchainPath,
                },
            };
        }

        const serverOptions: ServerOptions = sourcekit;

        const errorHandler = new SourceKitLSPErrorHandler(5);
        const clientOptions: LanguageClientOptions = lspClientOptions(
            this.swiftVersion,
            this.folderContext.workspaceContext,
            workspaceFolder,
            this.activeDocumentManager,
            errorHandler,
            this.folderGate,
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
            },
            (document, codeLens) => {
                const documentFolderContext = [this.folderContext, ...this.addedFolders].find(
                    folderContext => document.uri.fsPath.startsWith(folderContext.folder.fsPath)
                );
                if (!documentFolderContext) {
                    this.languageClientOutputChannel?.warn(
                        "Unable to find folder for document: " + document.uri.fsPath
                    );
                    return;
                }
                this.options.onDocumentCodeLens?.(documentFolderContext, document, codeLens);
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

    private async startClient(
        client: LanguageClient,
        errorHandler: SourceKitLSPErrorHandler
    ): Promise<void> {
        // Monitors the client's state and waits for it to enter the Running state.
        // If the client fails to start and enters the Stopped state, the promise is rejected.
        const runningPromise = new Promise<void>((res, rej) => {
            if (client.state === State.Running) {
                res();
                return;
            }
            const disposable = client.onDidChangeState(async e => {
                // if state is now running add in any sub-folder workspaces that
                // we have cached. If this is the first time we are starting then
                // we won't have any sub folder workspaces, but if the server crashed
                // or we forced a restart then we need to do this
                if (e.oldState === State.Starting && e.newState === State.Running) {
                    disposable.dispose();
                    res();
                } else if (e.oldState === State.Starting && e.newState === State.Stopped) {
                    disposable.dispose();
                    rej("SourceKit-LSP failed to start");
                }
            });
        });

        this.logger.info(
            client.clientOptions.workspaceFolder
                ? `SourceKit-LSP setup for ${FolderContext.uriName(
                      client.clientOptions.workspaceFolder.uri
                  )}`
                : `SourceKit-LSP setup`
        );

        client.onNotification(SourceKitLogMessageNotification.type, params => {
            this.logMessage(client, params as SourceKitLogMessageParams);
        });

        await client.start();
        await runningPromise;

        try {
            // start client

            // Now that we've started up correctly, start the error handler to auto-restart
            // if sourcekit-lsp crashes during normal operation.
            errorHandler.enable();

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
                // do nothing, the experimental capability is not supported
            }
        } catch (reason) {
            this.logger.error(`Error starting SourceKit-LSP in startClient: ${reason}`);
            if (this.languageClient?.state === State.Running) {
                await this.languageClient?.stop();
            }
            this.languageClient = undefined;
            throw reason;
        }

        this.languageClient = client;
        this.cancellationToken = new vscode.CancellationTokenSource();
    }

    private get languageClientOutputChannel(): SwiftOutputChannel | undefined {
        return this.languageClient?.outputChannel as SwiftOutputChannel | undefined;
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
const enum LanguageClientError {
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
