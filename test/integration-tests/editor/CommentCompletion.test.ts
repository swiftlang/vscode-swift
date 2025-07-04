//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import * as vscode from "vscode";
import { CommentCompletionProviders } from "../../../src/editor/CommentCompletion";
import { Workbench } from "../../../src/utilities/commands";

suite("CommentCompletion Test Suite", () => {
    let document: vscode.TextDocument | undefined;
    let provider: CommentCompletionProviders;

    setup(() => {
        provider = new CommentCompletionProviders();
    });

    teardown(async () => {
        const editor = vscode.window.visibleTextEditors.find(
            editor => editor.document === document
        );

        if (editor && document) {
            await vscode.window.showTextDocument(document, editor.viewColumn);
            await vscode.commands.executeCommand(Workbench.ACTION_CLOSEALLEDITORS);
        }

        provider.dispose();
    });

    test("Completion on line that isn't a comment", async () => {
        const { document, positions } = await openDocument(`
            1️⃣
            func foo() {}`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, undefined);
    });

    test("Comment completion on line that isn't a function", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            let x = 1`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, undefined);
    });

    test("Comment completion on func with no argument, no return should have no completions", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo() {}`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, undefined);
    });

    test("Comment completion on single argument function, no return should have a completion", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo(bar: Int) {}`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, [
            expectedCompletionItem(` $1
/// - Parameter bar: $2`),
        ]);
    });

    test("Comment completion on single argument function, with return should have a completion", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo(bar: Int) -> Int { return 0 }`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, [
            expectedCompletionItem(` $1
/// - Parameter bar: $2
/// - Returns: $3`),
        ]);
    });

    test("Comment completion on a throwing function", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo() throws {}`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, [
            expectedCompletionItem(` $1
/// - Throws: $2`),
        ]);
    });

    test("Comment completion on single argument throwing function", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo(bar: Int) throws {}`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, [
            expectedCompletionItem(` $1
/// - Parameter bar: $2
/// - Throws: $3`),
        ]);
    });

    test("Comment completion on complex function", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo(bar: Int, baz: String) -> Data throws { return Data() }`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, [
            expectedCompletionItem(
                ` $1
/// - Parameters:
///   - bar: $2
///   - baz: $3
/// - Returns: $4`
            ),
        ]);
    });

    test("Comment completion on complex typed throwing function", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo(bar: Int, baz: String) -> Data throws(MyError) { return Data() }`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, [
            expectedCompletionItem(
                ` $1
/// - Parameters:
///   - bar: $2
///   - baz: $3
/// - Returns: $4`
            ),
        ]);
    });

    test("Comment Insertion", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo(bar: Int, baz: String) -> Data throws { return Data() }`);
        const position = positions["1️⃣"];

        const editor = await vscode.window.showTextDocument(document);
        await provider.insert(editor, position.line + 1);

        assert.deepEqual(
            editor.document.getText(),
            `
            /// !
            ///  !
            /// - Parameters:
            ///   - bar: !
            ///   - baz: !
            /// - Returns: !
            func foo(bar: Int, baz: String) -> Data throws { return Data() }`.replace(/!/g, "")
        ); // ! ensures trailing white space is not trimmed when this file is formatted.
    });

    test("Comment completion on function with default parameter using #function", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo(f: String = #function) {}`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, [
            expectedCompletionItem(` $1
/// - Parameter f: $2`),
        ]);
    });

    test("Comment completion on function with parameter named 'func'", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo(func: String) {}`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, [
            expectedCompletionItem(` $1
/// - Parameter func: $2`),
        ]);
    });

    test("Comment completion on function with function and parameter named 'func' and #function default, returning function type", async () => {
        const { document, positions } = await openDocument(`
            /// 1️⃣
            public func \`func\`(func: #function) -> function {}`);
        const position = positions["1️⃣"];

        const items = await provider.functionCommentCompletion.provideCompletionItems(
            document,
            position
        );
        assert.deepEqual(items, [
            expectedCompletionItem(` $1
/// - Parameter func: $2
/// - Returns: $3`),
        ]);
    });

    function expectedCompletionItem(snippet: string): vscode.CompletionItem {
        const expected = new vscode.CompletionItem(
            "/// - parameters:",
            vscode.CompletionItemKind.Text
        );
        expected.detail = "Function documentation comment";
        expected.insertText = new vscode.SnippetString(snippet);
        expected.sortText = undefined;
        return expected;
    }

    async function openDocument(content: string): Promise<{
        document: vscode.TextDocument;
        positions: { [key: string]: vscode.Position };
    }> {
        function positionOf(str: string, content: string): vscode.Position | undefined {
            const lines = content.split("\n");
            const line = lines.findIndex(line => line.includes(str));
            if (line === -1) {
                return;
            }

            const column = lines[line].indexOf(str);
            return new vscode.Position(line, column);
        }

        let purgedContent = content;
        const needles = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];

        // Find all the needles, capture their positions and then remove them from
        // the document before creating a vscode.TextDocument.
        const positions = needles.reduce(
            (prev, needle) => {
                const pos = positionOf(needle, content);
                if (pos) {
                    purgedContent = purgedContent.replace(needle, "");
                    prev[needle] = pos;
                }
                return prev;
            },
            {} as { [key: string]: vscode.Position }
        );

        const doc = await vscode.workspace.openTextDocument({
            language: "swift",
            content: purgedContent,
        });

        // Save the document so we can clean it up when the test finishes
        document = doc;

        return { document: doc, positions };
    }
});
