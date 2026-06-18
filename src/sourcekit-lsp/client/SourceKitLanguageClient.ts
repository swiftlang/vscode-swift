//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as path from "path";
import * as vscode from "vscode";
import {
    DynamicFeature,
    LanguageClientOptions,
    RevealOutputChannelOn,
    State,
    StaticFeature,
} from "vscode-languageclient";
import { WorkspaceFoldersFeature } from "vscode-languageclient/lib/common/workspaceFolder";
import { Executable, LanguageClient, ServerOptions } from "vscode-languageclient/node";

import { DiagnosticsManager } from "../../DiagnosticsManager";
import { FolderContext } from "../../FolderContext";
import { WorkspaceContext } from "../../WorkspaceContext";
import { promptForDiagnostics } from "../../commands/captureDiagnostics";
import configuration from "../../configuration";
import { ArgumentFilter, BuildFlags } from "../../toolchain/BuildFlags";
import { SwiftToolchain } from "../../toolchain/toolchain";
import { AsyncDisposable, Disposable } from "../../utilities/Disposable";
import { isPathInDirectory } from "../../utilities/filesystem";
import { swiftRuntimeEnv } from "../../utilities/utilities";
import { Version } from "../../utilities/version";
import { LanguageClientDocumentSelectors } from "../LanguageClientDocumentSelectors";
import { uriConverters } from "../uriConverters";
import { SourceKitLSPErrorHandler } from "./ErrorHandler";
import { ActiveDocumentFeature } from "./features/ActiveDocumentFeature";
import { FolderContextFeature } from "./features/FolderContextFeature";
import { GetReferenceDocumentFeature } from "./features/GetReferenceDocumentFeature";
import { LoggingFeature } from "./features/LoggingFeature";
import { PeekDocumentsFeature } from "./features/PeekDocumentsFeature";
import { checkExperimentalCapability } from "./utilities";

export interface SourceKitLanguageClientOptions {
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

export class SourceKitLanguageClient extends LanguageClient implements AsyncDisposable {
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

    private folderContextFeature: FolderContextFeature;
    private cancellationTokenSource = new vscode.CancellationTokenSource();

    get swiftVersion(): Version {
        return this.toolchain.swiftVersion;
    }

    get addedFolders(): FolderContext[] {
        return this.folderContextFeature.addedFolders;
    }

    constructor(
        public toolchain: SwiftToolchain,
        workspaceContext: WorkspaceContext,
        options: SourceKitLanguageClientOptions = {}
    ) {
        const lspConfig = configuration.lsp;
        const serverPathConfig = lspConfig.serverPath;
        const buildFlags = toolchain.buildFlags;
        const sdkArguments = [
            ...buildFlags.swiftDriverSDKFlags(true),
            ...buildFlags.swiftDriverTargetFlags(true),
            ...BuildFlags.filterArguments(
                configuration.buildArguments.concat(buildFlags.buildPathFlags()),
                SourceKitLanguageClient.buildArgumentFilter
            ),
        ];

        const inv = serverPathConfig
            ? { command: serverPathConfig, args: [] }
            : toolchain.getToolchainInvocation("sourcekit-lsp", []);

        const isCustomPath = Boolean(
            serverPathConfig && !isPathInDirectory(serverPathConfig, toolchain.toolchainPath)
        );
        const lspExecutable: Executable = {
            command: inv.command,
            args: [...inv.args, ...lspConfig.serverArguments, ...sdkArguments],
            options: {
                env: {
                    // Custom builds of SourceKit-LSP need to be made aware of the toolchain path
                    SOURCEKIT_TOOLCHAIN_PATH: isCustomPath ? toolchain.toolchainPath : undefined,
                    ...process.env,
                    ...configuration.swiftEnvironmentVariables,
                    ...swiftRuntimeEnv(),
                },
            },
        };

        const serverOptions: ServerOptions = lspExecutable;
        const clientOptions: LanguageClientOptions = {
            documentSelector: LanguageClientDocumentSelectors.sourcekitLSPDocumentTypes(),
            revealOutputChannelOn: RevealOutputChannelOn.Never,
            outputChannel: workspaceContext.loggerFactory.createOutputChannel(
                `SourceKit Language Server (${toolchain.swiftVersion.toString()})`,
                `sourcekit-lsp-${toolchain.swiftVersion.toString()}.log`
            ),
            middleware: {
                provideCompletionItem: async (document, position, context, token, next) => {
                    const result = await next(document, position, context, token);

                    if (!result) {
                        return result;
                    }

                    if (Array.isArray(result)) {
                        return addParameterHintsCommandsIfNeeded(result, document.uri);
                    }

                    return {
                        ...result,
                        items: addParameterHintsCommandsIfNeeded(result.items, document.uri),
                    };
                },
                provideCodeLenses: async (document, token, next) => {
                    const result = await next(document, token);
                    if (options.onDocumentCodeLens) {
                        const folderContext = this.addedFolders.find(f =>
                            document.uri.fsPath.startsWith(f.folder.fsPath)
                        );
                        if (folderContext) {
                            options.onDocumentCodeLens(folderContext, document, result);
                        }
                    }
                    return result?.map(codelens => {
                        switch (codelens.command?.command) {
                            case "swift.run":
                                codelens.command.title = `$(play)\u00A0${codelens.command.title}`;
                                break;
                            case "swift.debug":
                                codelens.command.title = `$(debug)\u00A0${codelens.command.title}`;
                                break;
                            case "swift.play":
                                codelens.command.title = `$(play)\u00A0${codelens.command.title}`;
                                break;
                        }
                        return codelens;
                    });
                },
                provideDocumentSymbols: async (document, token, next) => {
                    const result = await next(document, token);
                    const documentSymbols = result as vscode.DocumentSymbol[];
                    if (options.onDocumentSymbols) {
                        const folderContext = this.addedFolders.find(f =>
                            document.uri.fsPath.startsWith(f.folder.fsPath)
                        );
                        if (folderContext) {
                            options.onDocumentSymbols(folderContext, document, documentSymbols);
                        }
                    }
                    return result;
                },
                provideDefinition: async (document, position, token, next) => {
                    const result = await next(document, position, token);
                    const definitions = result as vscode.Location[];
                    if (
                        definitions &&
                        path.extname(definitions[0].uri.path) === ".swiftinterface" &&
                        definitions[0].uri.scheme === "file"
                    ) {
                        const uri = definitions[0].uri.with({ scheme: "readonly" });
                        return new vscode.Location(uri, definitions[0].range);
                    }
                    return result;
                },
                provideReferences: async (document, position, options, token, next) => {
                    const setting = configuration.lsp.includeDeclarationInFindAllReferences;
                    if (setting === "default") {
                        return next(document, position, options, token);
                    }
                    return next(
                        document,
                        position,
                        { ...options, includeDeclaration: setting === "always" },
                        token
                    );
                },
                // temporarily remove text edit from Inlay hints while SourceKit-LSP
                // returns invalid replacement text
                provideInlayHints: async (document, position, token, next) => {
                    const result = await next(document, position, token);
                    // remove textEdits for swift version earlier than 5.10 as it sometimes
                    // generated invalid textEdits
                    if (toolchain.swiftVersion.isLessThan(new Version(5, 10, 0))) {
                        result?.forEach(r => (r.textEdits = undefined));
                    }
                    return result;
                },
                handleDiagnostics: (uri, diagnostics) => {
                    workspaceContext.diagnostics.handleDiagnostics(
                        uri,
                        DiagnosticsManager.isSourcekit,
                        diagnostics
                    );
                },
                handleWorkDoneProgress: (() => {
                    let lastPrompted = new Date(0).getTime();
                    return (token, params, next) => {
                        const result = next(token, params);
                        const tokenString = token.toString();
                        const now = new Date().getTime();
                        const oneHour = 60 * 60 * 1000;
                        if (
                            now - lastPrompted > oneHour &&
                            tokenString.startsWith("sourcekitd-crashed")
                        ) {
                            // Only prompt once an hour in case sourcekit is in a crash loop
                            lastPrompted = now;
                            void promptForDiagnostics(workspaceContext);
                        }
                        if (tokenString.startsWith("indexing") && params.kind === "end") {
                            workspaceContext.indexingFinished();
                        }
                        return result;
                    };
                })(),
            },
            uriConverters,
            errorHandler: new SourceKitLSPErrorHandler(5),
            // Avoid attempting to reinitialize multiple times. If we fail to initialize
            // we aren't doing anything different the second time and so will fail again.
            initializationFailedHandler: () => false,
            initializationOptions: initializationOptions(toolchain.swiftVersion),
        };

        super(
            "swift.sourcekit-lsp",
            `SourceKit Language Server (${toolchain.swiftVersion.toString()})`,
            serverOptions,
            clientOptions
        );
        this.folderContextFeature = new FolderContextFeature(this);
        this.registerFeature(this.folderContextFeature);
        this.registerFeature(new LoggingFeature(this));
        this.registerFeature(new ActiveDocumentFeature(this));
        this.registerFeature(new PeekDocumentsFeature(this));
        this.registerFeature(new GetReferenceDocumentFeature(this));
    }

    override registerFeature(feature: StaticFeature | DynamicFeature<unknown>): void {
        // The built-in workspace feature conflicts with our FolderContext feature
        if (feature instanceof WorkspaceFoldersFeature) {
            return;
        }
        super.registerFeature(feature);
    }

    addFolder(folder: FolderContext): Promise<void> {
        return this.folderContextFeature.addFolder(folder);
    }

    removeFolder(folder: FolderContext): Promise<void> {
        return this.folderContextFeature.removeFolder(folder);
    }

    checkExperimentalCapability(feature: string, minVersion: number): boolean {
        if (!this.initializeResult) {
            return false;
        }
        return checkExperimentalCapability(this.initializeResult.capabilities, feature, minVersion);
    }

    /**
     * Use language client safely. Provides a cancellation token to the function
     * which can be used to safely ensure language client requests are cancelled
     * if the language client is disposed.
     *
     * @param process process using language client
     * @returns result of process
     */
    async useLanguageClient<Return>(
        process: (
            client: SourceKitLanguageClient,
            cancellationToken: vscode.CancellationToken
        ) => Promise<Return>
    ): Promise<Return> {
        if (this.state !== State.Running) {
            const subscriptions: Disposable[] = [];
            await Promise.race([
                new Promise<void>(resolve => {
                    subscriptions.push(
                        this.onDidChangeState(event => {
                            if (event.newState === State.Running) {
                                resolve();
                            }
                        })
                    );
                }),
                new Promise<void>((_resolve, reject) => {
                    subscriptions.push(
                        this.cancellationTokenSource.token.onCancellationRequested(() =>
                            reject(Error("The operation was cancelled."))
                        )
                    );
                }),
            ]).finally(() => subscriptions.forEach(s => s.dispose()));
        }
        return process(this, this.cancellationTokenSource.token);
    }

    override async dispose(timeout?: number): Promise<void> {
        this.cancellationTokenSource.cancel();
        this.cancellationTokenSource.dispose();
        try {
            await super.dispose(timeout);
        } finally {
            this.outputChannel.dispose();
        }
    }
}

function initializationOptions(swiftVersion: Version): Record<string, unknown> {
    let options: Record<string, unknown> = {
        "textDocument/codeLens": {
            supportedCommands: {
                "swift.run": "swift.run",
                "swift.debug": "swift.debug",
                "swift.play": "swift.play",
            },
        },
    };

    // Swift 6.0.0 and later supports background indexing.
    // In 6.0.0 it is experimental so only "true" enables it.
    // In 6.1.0 it is no longer experimental, and so "auto" or "true" enables it.
    if (
        swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0)) &&
        (configuration.backgroundIndexing === "on" ||
            (configuration.backgroundIndexing === "auto" &&
                swiftVersion.isGreaterThanOrEqual(new Version(6, 1, 0))))
    ) {
        options = {
            ...options,
            backgroundIndexing: true,
            backgroundPreparationMode: "enabled",
        };
    }

    if (configuration.swiftSDK !== "") {
        options = {
            ...options,
            swiftPM: { swiftSDK: configuration.swiftSDK },
        };
    }

    return options;
}

function addParameterHintsCommandsIfNeeded(
    items: vscode.CompletionItem[],
    documentUri: vscode.Uri
): vscode.CompletionItem[] {
    if (!configuration.parameterHintsEnabled(documentUri)) {
        return items;
    }

    return items.map(item => {
        switch (item.kind) {
            case vscode.CompletionItemKind.Function:
            case vscode.CompletionItemKind.Method:
            case vscode.CompletionItemKind.Constructor:
            case vscode.CompletionItemKind.EnumMember:
                return {
                    command: {
                        title: "Trigger Parameter Hints",
                        command: "editor.action.triggerParameterHints",
                    },
                    ...item,
                };
            default:
                return item;
        }
    });
}
