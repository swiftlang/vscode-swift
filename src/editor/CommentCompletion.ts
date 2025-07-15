//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { DocumentParser } from "./DocumentParser";

function isLineComment(document: vscode.TextDocument, line: number): boolean {
    // test if line consists of just '///'
    return /^\s*\/\/\//.test(document.lineAt(line).text);
}

/** CompletionItem for Swift Comments */
class CommentCompletion extends vscode.CompletionItem {
    constructor(
        insertText: vscode.SnippetString | string,
        label: string,
        detail: string,
        sortText?: string
    ) {
        super(label, vscode.CompletionItemKind.Text);
        this.detail = detail;
        this.insertText = insertText;
        this.sortText = sortText;
    }
}

/**
 * CompletionItem Provider that provides "///" on pressing return if previous line
 * contained a "///" documentation comment.
 */
class DocCommentCompletionProvider implements vscode.CompletionItemProvider {
    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.CompletionItem[] | undefined> {
        // Is line a '///' comment
        if (
            position.line === 0 ||
            document.isClosed ||
            isLineComment(document, position.line - 1) === false
        ) {
            return undefined;
        }
        await this.continueExistingDocCommentBlock(document, position);
        return [new CommentCompletion("/// ", "///", "Documentation comment")];
    }

    private async continueExistingDocCommentBlock(
        document: vscode.TextDocument,
        position: vscode.Position
    ) {
        if (!vscode.window.activeTextEditor) {
            return;
        }
        // Fixes https://github.com/swiftlang/vscode-swift/issues/1648
        const lineText = document.lineAt(position.line).text;
        // Continue the comment if its a white space only line, or if VS Code has already continued
        // the comment by adding a // on the new line.
        const match =
            lineText.trim().length === 0
                ? [lineText, lineText, ""]
                : /^(\s*)\/\/\s(.+)/.exec(lineText);
        if (match) {
            await vscode.window.activeTextEditor.edit(
                edit => {
                    edit.replace(
                        new vscode.Range(position.line, 0, position.line, match[0].length),
                        `${match[1]}/// ${match[2]}`
                    );
                },
                { undoStopBefore: false, undoStopAfter: true }
            );
            const newPosition = new vscode.Position(position.line, match[1].length + 4);
            vscode.window.activeTextEditor.selection = new vscode.Selection(
                newPosition,
                newPosition
            );
        }
    }
}

interface FunctionDetails {
    indent: number;
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
        const isComment = isLineComment(document, position.line);
        if (isComment === false) {
            return undefined;
        }

        // is it above function definition
        const funcPosition = new vscode.Position(position.line + 1, 0);
        const details = this.getFunctionDetails(document, funcPosition);
        if (details) {
            if (
                details.parameters.length === 0 &&
                details.returns === false &&
                details.throws === false
            ) {
                return undefined;
            }
            const snippet = this.constructSnippet(details, false);
            const completion = new CommentCompletion(
                snippet,
                "/// - parameters:",
                "Function documentation comment"
            );
            return [completion];
        }

        return undefined;
    }

    /**
     * Insert function header comment text snippet
     * @param editor text editor to edit
     * @param line line number of function
     */
    async insert(editor: vscode.TextEditor, line: number) {
        const position = new vscode.Position(line, 0);
        const document = editor.document;
        const details = this.getFunctionDetails(document, position);
        if (details) {
            const snippet = this.constructSnippet(details, true);
            const insertPosition = new vscode.Position(line, details.indent);
            await editor.insertSnippet(snippet, insertPosition);
        }
    }

    /**
     * Extract function details from line below. Inspiration for this code can be found
     * here https://github.com/fappelman/swift-add-documentation
     */
    private getFunctionDetails(
        document: vscode.TextDocument,
        position: vscode.Position
    ): FunctionDetails | null {
        const parser = new DocumentParser(document, position);
        if (!parser.match(/\b(?:func|init)\b(?=[^{]*\{)/)) {
            return null;
        }
        const funcName = parser.match(/^([^(<]*)\s*(\(|<)/);
        if (!funcName) {
            return null;
        }
        // if we catch "<" then we have generic arguments
        if (funcName[1] === "<") {
            parser.skipUntil(">");
            // match open bracket
            if (!parser.match(/^\(/)) {
                return null;
            }
        }
        // extract parameters
        const parameters: string[] = [];
        // if next character is ")" skip parameter parsing
        if (!parser.match(/^\)/)) {
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
        }
        // go through function markers
        let throws = false;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const mark = parser.match(/^\s*([a-z]+)/);
            if (!mark || mark.length === 0) {
                break;
            }
            if (mark[0] === "throws") {
                throws = true;

                // Check for a type annotation on the throw i.e. throws(MyError)
                parser.match(/^\s*(\(.*\))/);
            }
        }
        // if we find a `->` then function returns a value
        const returns = parser.match(/^\s*->/) !== null;
        // read function
        return {
            indent: document.lineAt(position.line).firstNonWhitespaceCharacterIndex,
            parameters: parameters,
            returns: returns,
            throws: throws,
        };
    }

    private constructSnippet(
        details: FunctionDetails,
        completeSnippet: boolean
    ): vscode.SnippetString {
        let string = "";
        if (completeSnippet) {
            string += "/// ";
        }
        string += " $1";
        let snippetIndex = 2;
        if (details.parameters.length === 1) {
            string += `\n/// - Parameter ${details.parameters[0]}: $${snippetIndex}`;
            snippetIndex++;
        } else if (details.parameters.length > 0) {
            string += "\n/// - Parameters:";
            for (const parameter of details.parameters) {
                string += `\n///   - ${parameter}: $${snippetIndex}`;
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
        if (completeSnippet) {
            string += "\n";
        }
        return new vscode.SnippetString(string);
    }
}

/**
 * Interface to comment completion providers
 */
export class CommentCompletionProviders implements vscode.Disposable {
    functionCommentCompletion: FunctionDocumentationCompletionProvider;
    docCommentCompletion: DocCommentCompletionProvider;
    functionCommentCompletionProvider: vscode.Disposable;
    docCommentCompletionProvider: vscode.Disposable;

    constructor() {
        this.functionCommentCompletion = new FunctionDocumentationCompletionProvider();
        this.functionCommentCompletionProvider = vscode.languages.registerCompletionItemProvider(
            "swift",
            this.functionCommentCompletion,
            "/"
        );
        this.docCommentCompletion = new DocCommentCompletionProvider();
        this.docCommentCompletionProvider = vscode.languages.registerCompletionItemProvider(
            "swift",
            this.docCommentCompletion,
            "\n"
        );
    }

    /**
     * Insert function header comment text snippet
     * @param editor text editor to edit
     * @param line line number of function
     */
    async insert(editor: vscode.TextEditor, line: number) {
        await this.functionCommentCompletion.insert(editor, line);
    }

    dispose() {
        this.functionCommentCompletionProvider.dispose();
        this.docCommentCompletionProvider.dispose();
    }
}
