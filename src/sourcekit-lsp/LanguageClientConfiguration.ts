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
import * as path from "path";
import {
    DocumentSelector,
    LanguageClientOptions,
    RevealOutputChannelOn,
    vsdiag,
} from "vscode-languageclient";
import configuration from "../configuration";
import { Version } from "../utilities/version";
import { WorkspaceContext } from "../WorkspaceContext";
import { DiagnosticsManager } from "../DiagnosticsManager";
import { promptForDiagnostics } from "../commands/captureDiagnostics";
import { uriConverters } from "./uriConverters";
import { LSPActiveDocumentManager } from "./didChangeActiveDocument";
import { SourceKitLSPErrorHandler } from "./LanguageClientManager";

/* eslint-disable @typescript-eslint/no-explicit-any */
function initializationOptions(swiftVersion: Version): any {
    let options: any = {
        "textDocument/codeLens": {
            supportedCommands: {
                "swift.run": "swift.run",
                "swift.debug": "swift.debug",
            },
        },
    };

    // Swift 6.3 changed the value to enable experimental client capabilities from `true` to `{ "supported": true }`
    // (https://github.com/swiftlang/sourcekit-lsp/pull/2204)
    if (swiftVersion.isGreaterThanOrEqual(new Version(6, 3, 0))) {
        options = {
            "workspace/peekDocuments": {
                supported: true, // workaround for client capability to handle `PeekDocumentsRequest`
            },
            "workspace/getReferenceDocument": {
                supported: true, // the client can handle URIs with scheme `sourcekit-lsp:`
            },
        };
    } else {
        options = {
            ...options,
            "workspace/peekDocuments": true, // workaround for client capability to handle `PeekDocumentsRequest`
            "workspace/getReferenceDocument": true, // the client can handle URIs with scheme `sourcekit-lsp:`
        };
    }

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

    if (swiftVersion.isGreaterThanOrEqual(new Version(6, 3, 0))) {
        options = {
            ...options,
            "window/didChangeActiveDocument": {
                supported: true, // the client can send `window/didChangeActiveDocument` notifications
            },
        };
    } else if (swiftVersion.isGreaterThanOrEqual(new Version(6, 1, 0))) {
        options = {
            ...options,
            "window/didChangeActiveDocument": true, // the client can send `window/didChangeActiveDocument` notifications
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
/* eslint-enable @typescript-eslint/no-explicit-any */

type SourceKitDocumentSelector = {
    scheme: string;
    language: string;
    pattern?: string;
}[];

export class LanguagerClientDocumentSelectors {
    static appleLangDocumentSelector: SourceKitDocumentSelector = [
        { scheme: "sourcekit-lsp", language: "swift" },
        { scheme: "file", language: "swift" },
        { scheme: "untitled", language: "swift" },
        { scheme: "fba", language: "swift" },
        { scheme: "file", language: "objective-c" },
        { scheme: "untitled", language: "objective-c" },
        { scheme: "file", language: "objective-cpp" },
        { scheme: "untitled", language: "objective-cpp" },
    ];

    static cFamilyDocumentSelector: SourceKitDocumentSelector = [
        { scheme: "file", language: "c" },
        { scheme: "untitled", language: "c" },
        { scheme: "file", language: "cpp" },
        { scheme: "untitled", language: "cpp" },
    ];

    // document selector for swift-docc documentation
    static documentationDocumentSelector: SourceKitDocumentSelector = [
        { scheme: "file", language: "markdown" },
        { scheme: "untitled", language: "markdown" },
        { scheme: "file", language: "tutorial" },
        { scheme: "untitiled", language: "tutorial" },
    ];

    static miscelaneousDocumentSelector: SourceKitDocumentSelector = [
        { scheme: "file", language: "plaintext", pattern: "**/.swift-version" },
    ];

    static sourcekitLSPDocumentTypes(): DocumentSelector {
        let documentSelector: SourceKitDocumentSelector;
        switch (configuration.lsp.supportCFamily) {
            case "enable":
                documentSelector = [
                    ...LanguagerClientDocumentSelectors.appleLangDocumentSelector,
                    ...LanguagerClientDocumentSelectors.cFamilyDocumentSelector,
                ];
                break;

            case "disable":
                documentSelector = LanguagerClientDocumentSelectors.appleLangDocumentSelector;
                break;

            case "cpptools-inactive": {
                const cppToolsActive =
                    vscode.extensions.getExtension("ms-vscode.cpptools")?.isActive;
                documentSelector =
                    cppToolsActive === true
                        ? LanguagerClientDocumentSelectors.appleLangDocumentSelector
                        : [
                              ...LanguagerClientDocumentSelectors.appleLangDocumentSelector,
                              ...LanguagerClientDocumentSelectors.cFamilyDocumentSelector,
                          ];
            }
        }
        documentSelector = documentSelector.filter(doc => {
            return configuration.lsp.supportedLanguages.includes(doc.language);
        });
        documentSelector.push(...LanguagerClientDocumentSelectors.documentationDocumentSelector);
        return documentSelector;
    }

    static allHandledDocumentTypes(): DocumentSelector {
        return [
            ...this.sourcekitLSPDocumentTypes(),
            ...LanguagerClientDocumentSelectors.miscelaneousDocumentSelector,
        ];
    }
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

export function lspClientOptions(
    swiftVersion: Version,
    workspaceContext: WorkspaceContext,
    workspaceFolder: vscode.WorkspaceFolder | undefined,
    activeDocumentManager: LSPActiveDocumentManager,
    errorHandler: SourceKitLSPErrorHandler,
    documentSymbolWatcher?: (
        document: vscode.TextDocument,
        symbols: vscode.DocumentSymbol[]
    ) => void
): LanguageClientOptions {
    return {
        documentSelector: LanguagerClientDocumentSelectors.sourcekitLSPDocumentTypes(),
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        workspaceFolder,
        outputChannel: workspaceContext.loggerFactory.create(
            `SourceKit Language Server (${swiftVersion.toString()})`,
            `sourcekit-lsp-${swiftVersion.toString()}.log`,
            { outputChannel: true }
        ),
        middleware: {
            didOpen: activeDocumentManager.didOpen.bind(activeDocumentManager),
            didClose: activeDocumentManager.didClose.bind(activeDocumentManager),
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
                return result?.map(codelens => {
                    switch (codelens.command?.command) {
                        case "swift.run":
                            codelens.command.title = `$(play)\u00A0${codelens.command.title}`;
                            break;
                        case "swift.debug":
                            codelens.command.title = `$(debug)\u00A0${codelens.command.title}`;
                            break;
                    }
                    return codelens;
                });
            },
            provideDocumentSymbols: async (document, token, next) => {
                const result = await next(document, token);
                const documentSymbols = result as vscode.DocumentSymbol[];
                if (documentSymbolWatcher && documentSymbols) {
                    documentSymbolWatcher(document, documentSymbols);
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
            // temporarily remove text edit from Inlay hints while SourceKit-LSP
            // returns invalid replacement text
            provideInlayHints: async (document, position, token, next) => {
                const result = await next(document, position, token);
                // remove textEdits for swift version earlier than 5.10 as it sometimes
                // generated invalid textEdits
                if (swiftVersion.isLessThan(new Version(5, 10, 0))) {
                    result?.forEach(r => (r.textEdits = undefined));
                }
                return result;
            },
            provideDiagnostics: async (uri, previousResultId, token, next) => {
                const result = await next(uri, previousResultId, token);
                if (result?.kind === vsdiag.DocumentDiagnosticReportKind.unChanged) {
                    return undefined;
                }
                const document = uri as vscode.TextDocument;
                workspaceContext.diagnostics.handleDiagnostics(
                    document.uri ?? uri,
                    DiagnosticsManager.isSourcekit,
                    result?.items ?? []
                );
                return undefined;
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
                return async (token, params, next) => {
                    const result = next(token, params);
                    const now = new Date().getTime();
                    const oneHour = 60 * 60 * 1000;
                    if (
                        now - lastPrompted > oneHour &&
                        token.toString().startsWith("sourcekitd-crashed")
                    ) {
                        // Only prompt once an hour in case sourcekit is in a crash loop
                        lastPrompted = now;
                        void promptForDiagnostics(workspaceContext);
                    }
                    return result;
                };
            })(),
        },
        uriConverters,
        errorHandler,
        // Avoid attempting to reinitialize multiple times. If we fail to initialize
        // we aren't doing anything different the second time and so will fail again.
        initializationFailedHandler: () => false,
        initializationOptions: initializationOptions(swiftVersion),
    };
}
