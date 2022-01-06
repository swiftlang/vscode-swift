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
        const nextLineIndex = position.line + 1;
        if (nextLineIndex > document.lineCount) {
            return null;
        }
        const nextLine = document.lineAt(nextLineIndex);
        // try to extract the function parameters from function and whether it returns anything
        // doesn't support capturing throws, init functions, multiline functions
        const match = /func\s([^(<]*)(?:<.*>(?:<.*>)?)?\((.*)(?:(.*)?)\)[^-{]*(->)?.*/.exec(
            nextLine.text
        );
        if (match) {
            let parameters: string[] | undefined;
            if (match[2]) {
                // try to extract parameters from parameter list, doesnt support extracting
                // parameter aliases, generics with multiple type parameters
                const paramMatch = match[2].match(/([^:]*):(?:[^,]*)[,]?/g);
                parameters = paramMatch?.map(match => {
                    return /\s*([^:]*):/.exec(match)![1];
                });
            }
            return {
                parameters: parameters ?? [],
                returns: match[4] !== undefined,
            };
        }
        return null;
    }

    private constructSnippetString(details: FunctionDetails): string {
        let string = " $1";
        let snippetIndex = 2;
        if (details.parameters.length > 0) {
            string += "\n/// - parameters:";
            for (const parameter of details.parameters) {
                string += `\n///     - ${parameter}: $${snippetIndex}`;
                snippetIndex++;
            }
        }
        if (details.returns) {
            string += `\n/// - returns: $${snippetIndex}`;
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
