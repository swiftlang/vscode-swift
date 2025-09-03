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
import { CommentCompletionProviders } from "@src/editor/CommentCompletion";

suite("CommentCompletion Test Suite", () => {
    let provider: CommentCompletionProviders;

    setup(() => {
        provider = new CommentCompletionProviders();
    });

    teardown(() => provider.dispose());

    suite("Function Comment Completion", () => {
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

        test("Comment insertion", async function () {
            if (process.platform === "linux") {
                // Linux tests are having issues with open text editors
                this.skip();
            }

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

        suite("Function Comment Completion - Edge Cases", () => {
            test("Comment completion on generic function", async () => {
                const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo<T>(bar: T) -> T { return bar }`);
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

            test("Comment completion on generic function with multiple type parameters", async () => {
                const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo<T, U>(bar: T, baz: U) -> T { return bar }`);
                const position = positions["1️⃣"];

                const items = await provider.functionCommentCompletion.provideCompletionItems(
                    document,
                    position
                );
                assert.deepEqual(items, [
                    expectedCompletionItem(` $1
/// - Parameters:
///   - bar: $2
///   - baz: $3
/// - Returns: $4`),
                ]);
            });

            test("Comment completion on generic function with constraints", async () => {
                const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo<T: Equatable>(bar: T) -> T { return bar }`);
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

            test("Comment completion on malformed function - no function name", async () => {
                const { document, positions } = await openDocument(`
            /// 1️⃣
            func (bar: Int) {}`);
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

            test("Comment completion on malformed function - no parameter name", async () => {
                const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo(: Int) {}`);
                const position = positions["1️⃣"];

                const items = await provider.functionCommentCompletion.provideCompletionItems(
                    document,
                    position
                );
                assert.deepEqual(items, [
                    expectedCompletionItem(` $1
/// - Parameter : $2`),
                ]);
            });

            test("Comment completion on malformed function - unclosed parameter list", async () => {
                const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo(bar: Int`);
                const position = positions["1️⃣"];

                const items = await provider.functionCommentCompletion.provideCompletionItems(
                    document,
                    position
                );
                assert.deepEqual(items, undefined);
            });

            test("Comment completion on malformed generic function - unclosed generic list", async () => {
                const { document, positions } = await openDocument(`
            /// 1️⃣
            func foo<T(bar: Int) {}`);
                const position = positions["1️⃣"];

                const items = await provider.functionCommentCompletion.provideCompletionItems(
                    document,
                    position
                );
                assert.deepEqual(items, undefined);
            });

            test("Comment completion on init method", async () => {
                const { document, positions } = await openDocument(`
            /// 1️⃣
            init(bar: Int) {}`);
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

            test("Comment completion on throwing init method", async () => {
                const { document, positions } = await openDocument(`
            /// 1️⃣
            init(bar: Int) throws {}`);
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
        });
    });

    suite("Document Comment Completion", function () {
        test("Should not provide completions on first line", async () => {
            const { document, positions } = await openDocument(`1️⃣
            public func foo() {}`);

            const position = positions["1️⃣"];
            const items = await provider.docCommentCompletion.provideCompletionItems(
                document,
                position
            );

            assert.strictEqual(items, undefined, "Should not provide completions on first line");
        });

        test("Should not provide completions when previous line is not a comment", async () => {
            const { document, positions } = await openDocument(`
            public func bar() {}
            1️⃣
            public func foo() {}`);

            const position = positions["1️⃣"];
            const items = await provider.docCommentCompletion.provideCompletionItems(
                document,
                position
            );

            assert.strictEqual(
                items,
                undefined,
                "Should not provide completions when previous line is not a comment"
            );
        });

        test("Should continue a documentation comment block on new line", async () => {
            const { document, positions } = await openDocument(`
/// aaa
1️⃣
public func foo() {}`);

            const position = positions["1️⃣"];
            await provider.docCommentCompletion.provideCompletionItems(document, position);

            const newLine = document.lineAt(position.line).text;

            assert.strictEqual(newLine, "/// ", "New line should continue the comment block");
        });

        test("Should continue a documentation comment when an existing comment line is split", async () => {
            const { document, positions } = await openDocument(`
/// aaa
1️⃣// bbb
public func foo() {}`);

            const position = positions["1️⃣"];
            await provider.docCommentCompletion.provideCompletionItems(document, position);

            const newLine = document.lineAt(position.line).text;

            assert.strictEqual(newLine, "/// bbb", "New line should continue the comment block");
        });

        test("Should not continue a comment on a line that has content", async () => {
            const { document, positions } = await openDocument(`
            /// aaa
            public func foo(param: Int, a1️⃣) {}`);

            const originalText = document.getText();
            const position = positions["1️⃣"];
            await provider.docCommentCompletion.provideCompletionItems(document, position);

            const documentText = document.getText();

            assert.deepEqual(documentText, originalText, "Document text should not change");
        });

        test("Should handle when previous line has // but not ///", async () => {
            const { document, positions } = await openDocument(`
            // aaa
            1️⃣
            public func foo() {}`);

            const position = positions["1️⃣"];
            const items = await provider.docCommentCompletion.provideCompletionItems(
                document,
                position
            );

            assert.strictEqual(
                items,
                undefined,
                "Should not provide completions when previous line is not a doc comment"
            );
        });

        test("Should handle when line has content after //", async () => {
            const { document, positions } = await openDocument(`
            /// aaa
            1️⃣// bbb
            public func foo() {}`);

            const position = positions["1️⃣"];

            const items = await provider.docCommentCompletion.provideCompletionItems(
                document,
                position
            );

            // Check that the line was modified
            const lineText = document.lineAt(position.line).text;
            assert.strictEqual(lineText.trim(), "/// bbb", "Should convert // to ///");

            assert.ok(items, "Should provide completions");
            assert.strictEqual(items.length, 1, "Should provide one completion");
        });

        test("Should handle when line has no match for comment continuation", async () => {
            const { document, positions } = await openDocument(`
            /// aaa
            1️⃣let x = 1
            public func foo() {}`);

            const position = positions["1️⃣"];

            const originalText = document.getText();
            const items = await provider.docCommentCompletion.provideCompletionItems(
                document,
                position
            );

            // Document should not be modified
            assert.strictEqual(document.getText(), originalText, "Document should not be modified");

            assert.ok(items, "Should provide completions");
            assert.strictEqual(items.length, 1, "Should provide one completion");
        });
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

            return new vscode.Position(line, lines[line].indexOf(str));
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

        return { document: doc, positions };
    }
});
