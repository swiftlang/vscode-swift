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

export class DocumentParser {
    constructor(readonly document: vscode.TextDocument, private position: vscode.Position) {}

    match(expression: RegExp): string[] | null {
        const line = this.document.lineAt(this.position.line).text;
        const remainsOfLine = line.substring(this.position.character);
        // skip whitespace
        const whitespace = /^\s*/.exec(remainsOfLine);
        let whitespaceCount = 0;
        if (whitespace) {
            whitespaceCount = whitespace[0].length;
        }
        const text = remainsOfLine.substring(whitespaceCount);
        // match expression
        const result = expression.exec(text);
        if (result) {
            const offset = result.index + result[0].length;
            this.position = this.position.translate(undefined, offset + whitespaceCount);

            console.log(this.position);
            const results = result.map(match => match);
            results.shift();
            return results;
        }
        return null;
    }
}
