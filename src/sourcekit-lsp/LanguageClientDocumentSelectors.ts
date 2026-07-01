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
import { DocumentSelector } from "vscode-languageclient";

import configuration from "../configuration";

type SourceKitDocumentSelector = {
    scheme: string;
    language: string;
    pattern?: string;
}[];

export class LanguageClientDocumentSelectors {
    static readonly appleLangDocumentSelector: SourceKitDocumentSelector = [
        { scheme: "sourcekit-lsp", language: "swift" },
        { scheme: "file", language: "swift" },
        { scheme: "untitled", language: "swift" },
        { scheme: "file", language: "objective-c" },
        { scheme: "untitled", language: "objective-c" },
        { scheme: "file", language: "objective-cpp" },
        { scheme: "untitled", language: "objective-cpp" },
    ];

    static readonly cFamilyDocumentSelector: SourceKitDocumentSelector = [
        { scheme: "file", language: "c" },
        { scheme: "untitled", language: "c" },
        { scheme: "file", language: "cpp" },
        { scheme: "untitled", language: "cpp" },
    ];

    static readonly documentationDocumentSelector: SourceKitDocumentSelector = [
        { scheme: "file", language: "markdown" },
        { scheme: "untitled", language: "markdown" },
        { scheme: "file", language: "tutorial" },
        { scheme: "untitiled", language: "tutorial" },
    ];

    static readonly miscellaneousDocumentSelector: SourceKitDocumentSelector = [
        { scheme: "file", language: "plaintext", pattern: "**/.swift-version" },
    ];

    static sourcekitLSPDocumentTypes(): DocumentSelector {
        let documentSelector: SourceKitDocumentSelector;
        switch (configuration.lsp.supportCFamily) {
            case "enable":
                documentSelector = [
                    ...LanguageClientDocumentSelectors.appleLangDocumentSelector,
                    ...LanguageClientDocumentSelectors.cFamilyDocumentSelector,
                ];
                break;

            case "disable":
                documentSelector = LanguageClientDocumentSelectors.appleLangDocumentSelector;
                break;

            case "cpptools-inactive": {
                const cppToolsActive =
                    vscode.extensions.getExtension("ms-vscode.cpptools")?.isActive;
                documentSelector =
                    cppToolsActive === true
                        ? LanguageClientDocumentSelectors.appleLangDocumentSelector
                        : [
                              ...LanguageClientDocumentSelectors.appleLangDocumentSelector,
                              ...LanguageClientDocumentSelectors.cFamilyDocumentSelector,
                          ];
            }
        }
        documentSelector = documentSelector.filter(doc => {
            return configuration.lsp.supportedLanguages.includes(doc.language);
        });
        documentSelector.push(...LanguageClientDocumentSelectors.documentationDocumentSelector);
        return documentSelector;
    }

    static allHandledDocumentTypes(): DocumentSelector {
        return [
            ...this.sourcekitLSPDocumentTypes(),
            ...LanguageClientDocumentSelectors.miscellaneousDocumentSelector,
        ];
    }
}
