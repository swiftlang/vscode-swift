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
import { DocumentParser } from "./Parser";

/** CompletionItem for Swift Comments */
class CommentCompletion extends vscode.CompletionItem {
    constructor(
        insertText: vscode.SnippetString | string,
        label: string,
        detail: string,
        range?: vscode.Range
    ) {
        super(label, vscode.CompletionItemKind.Text);
        this.detail = detail;
        this.insertText = insertText;
        this.range = range;
    }
}

/**
 * CompletionItem Provider that provides "///" on pressing return if previous line
 * contained a "///" documentation comment.
 */
class CommentCompletionProvider implements vscode.CompletionItemProvider {
    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.CompletionItem[] | undefined> {
        // Is line a '///' comment
        if (this.isLineComment(document, position.line - 1) === false) {
            return undefined;
        }
        const completion = new CommentCompletion("/// ", "///", "Documentation comment");
        return [completion];
    }

    private isLineComment(document: vscode.TextDocument, line: number): boolean {
        // test if line starts with '///'
        if (/^\s*\/\/\//.test(document.lineAt(line).text)) {
            return true;
        }
        return false;
    }
}

interface FunctionDetails {
    parameters: string[];
    returns: boolean;
    throws: boolean;
}

/**
 * CompletionItem provider that will generate a function documentation comment
 * based on the function declaration directly below. Triggered by pressing "/"
 */
class FunctionDocumentationCompletionProvider implements vscode.CompletionItemProvider {
    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.CompletionItem[] | undefined> {
        // Is line a '///' comment
        const isComment = this.isLineComment(document, position.line);
        if (isComment === false) {
            return undefined;
        }

        // is it above function definition
        const details = this.getFunctionDetails(document, position);
        if (details) {
            if (details.parameters.length === 0 && details.returns === false) {
                return undefined;
            }
            const snippetString = this.constructSnippetString(details);
            const snippet = new vscode.SnippetString(snippetString);
            const completion = new CommentCompletion(
                snippet,
                "/// - parameters:",
                "Function documentation comment"
            );
            return [completion];
        }

        return undefined;
    }

    private isLineComment(document: vscode.TextDocument, line: number): boolean {
        // test if line consists of just '///'
        if (/^\s*\/\/\/\s*$/.test(document.lineAt(line).text)) {
            return true;
        }
        return false;
    }

    private getFunctionDetails(
        document: vscode.TextDocument,
        position: vscode.Position
    ): FunctionDetails | null {
        const parser = new DocumentParser(document, new vscode.Position(position.line + 1, 0));
        if (!parser.match(/func/)) {
            return null;
        }
        const funcName = parser.match(/^(\S*)\s*([(<])/);
        if (!funcName) {
            return null;
        }
        // if we catch "<" then we have generic arguments
        if (funcName[1] === "<") {
            parser.skipUntil(">");
        }
        // extract parameters
        const parameters: string[] = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const parameter = parser.match(/(\S*)(?:\s*)?:/);
            if (!parameter) {
                return null;
            }
            parameters.push(...parameter);
            const nextChar = parser.skipUntil(",)");
            if (!nextChar) {
                return null;
            }
            if (nextChar === ")") {
                break;
            }
        }
        // go through function markers
        let throws = false;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const mark = parser.match(/([a-z]+)\s/);
            if (!mark || mark.length === 0) {
                break;
            }
            if (mark[0] === "throws") {
                throws = true;
            }
        }
        const returns = parser.match(/->/) !== null;
        // read function
        return {
            parameters: parameters,
            returns: returns,
            throws: throws,
        };
    }

    private constructSnippetString(details: FunctionDetails): string {
        let string = " $1";
        let snippetIndex = 2;
        if (details.parameters.length > 0) {
            string += "\n/// - Parameters:";
            for (const parameter of details.parameters) {
                string += `\n///     - ${parameter}: $${snippetIndex}`;
                snippetIndex++;
            }
        }
        if (details.throws) {
            string += `\n/// - Throws: $${snippetIndex}`;
            snippetIndex++;
        }
        if (details.returns) {
            string += `\n/// - Returns: $${snippetIndex}`;
        }
        return string;
    }
}

export function register(): vscode.Disposable {
    const functionCommentCompletion = vscode.languages.registerCompletionItemProvider(
        "swift",
        new FunctionDocumentationCompletionProvider(),
        "/"
    );
    const commentCompletion = vscode.languages.registerCompletionItemProvider(
        "swift",
        new CommentCompletionProvider(),
        "\n"
    );
    return {
        dispose: () => {
            functionCommentCompletion.dispose();
            commentCompletion.dispose();
        },
    };
}
