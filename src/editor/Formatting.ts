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
import { execSwift } from "../utilities/utilities";

const wholeDocumentRange = new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

function format(request: {
    document: vscode.TextDocument;
    parameters?: string[];
    range?: vscode.Range;
    formatting: vscode.FormattingOptions;
}): Promise<never[] | vscode.TextEdit[]> {
    const input = request.document.getText(request.range);
    if (input.trim() === "") {
        return Promise.resolve([]);
    }
    const formatProc = execSwift(
        ["format", ...(request.parameters || [])],
        "default",
        {},
        undefined,
        input
    );
    return formatProc
        .then(result => {
            if (result.stderr) {
                // FIXME: handle stderr
                return [];
            }
            const newContents = result.stdout;
            return newContents !== request.document.getText(request.range)
                ? [
                      vscode.TextEdit.replace(
                          request.document.validateRange(request.range || wholeDocumentRange),
                          newContents
                      ),
                  ]
                : [];
        })
        .catch((/* error */) => {
            // FIXME: handle error
            return [];
        });
}

export class FormattingProvider
    implements
        vscode.DocumentRangeFormattingEditProvider,
        vscode.DocumentFormattingEditProvider,
        vscode.OnTypeFormattingEditProvider
{
    constructor() {
        const provider = new FormattingProvider();
        const swiftSelector: vscode.DocumentSelector = {
            scheme: "file",
            language: "swift",
        };
        vscode.languages.registerDocumentRangeFormattingEditProvider(swiftSelector, provider);
        vscode.languages.registerDocumentFormattingEditProvider(swiftSelector, provider);
        vscode.languages.registerOnTypeFormattingEditProvider(swiftSelector, provider, "\n");
    }
    async provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        formatting: vscode.FormattingOptions
    ) {
        return await format({
            document,
            parameters: [],
            range,
            formatting,
        });
    }
    async provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        formatting: vscode.FormattingOptions
    ) {
        return await format({ document, formatting });
    }
    async provideOnTypeFormattingEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        _: string,
        formatting: vscode.FormattingOptions
    ) {
        // Don't format if user has inserted an empty line
        if (document.lineAt(position.line).text.trim() === "") {
            return [];
        }
        return await format({ document, formatting });
    }
}
