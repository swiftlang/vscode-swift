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
import { expect } from "chai";
import * as vscode from "vscode";

import { DocumentParser } from "@src/editor/DocumentParser";

import { instance, mockFn, mockObject } from "../../MockUtils";

suite("DocumentParser Unit Tests", () => {
    function createParser(
        content: string,
        position: vscode.Position = new vscode.Position(0, 0)
    ): DocumentParser {
        const lines = content.split("\n");
        const document = mockObject<vscode.TextDocument>({
            lineCount: lines.length,
            lineAt: mockFn(s =>
                s.callsFake((line: number) => ({ text: lines[line] }) as vscode.TextLine)
            ),
        });
        return new DocumentParser(instance(document), position);
    }

    suite("match", () => {
        test("returns the capture groups without the full match", () => {
            const parser = createParser("func foo(bar: Int) {}");

            expect(parser.match(/(func)\s+(\w+)/)).to.deep.equal(["func", "foo"]);
        });

        test("advances past the match so that the next match continues from there", () => {
            const parser = createParser("func foo(bar: Int) {}");

            expect(parser.match(/\bfunc\b/)).to.deep.equal([]);
            expect(parser.match(/^(\w+)\(/)).to.deep.equal(["foo"]);
            expect(parser.match(/^(\w+):/)).to.deep.equal(["bar"]);
        });

        test("skips leading whitespace and blank lines", () => {
            const parser = createParser("\n   \n    func foo() {}");

            expect(parser.match(/^func (\w+)/)).to.deep.equal(["foo"]);
        });

        test("only matches against the current line", () => {
            const parser = createParser("func foo(\n    bar: Int\n) {}");

            expect(parser.match(/\{/)).to.be.null;
        });

        test("returns null when the expression does not match", () => {
            const parser = createParser("let x = 1");

            expect(parser.match(/\bfunc\b/)).to.be.null;
        });

        test("returns null when there is no more content in the document", () => {
            const parser = createParser("func foo() {}\n\n   ", new vscode.Position(1, 0));

            expect(parser.match(/.*/)).to.be.null;
        });
    });

    suite("skipUntil", () => {
        test("returns the first matching character and advances past it", () => {
            const parser = createParser("bar: Int, baz: String)");

            expect(parser.skipUntil(",)")).to.equal(",");
            expect(parser.match(/^(\w+):/)).to.deep.equal(["baz"]);
            expect(parser.skipUntil(",)")).to.equal(")");
        });

        test("ignores characters nested inside delimiters", () => {
            const parser = createParser(
                "a: (Int, Int) -> Void, b: [String: Int], c: Set<Int>, d: () -> Void = { _ in }) after"
            );

            expect(parser.skipUntil(",)")).to.equal(",");
            expect(parser.match(/^(\w+):/)).to.deep.equal(["b"]);
            expect(parser.skipUntil(",)")).to.equal(",");
            expect(parser.match(/^(\w+):/)).to.deep.equal(["c"]);
            expect(parser.skipUntil(",)")).to.equal(",");
            expect(parser.match(/^(\w+):/)).to.deep.equal(["d"]);
            expect(parser.skipUntil(",)")).to.equal(")");
            expect(parser.match(/^(\w+)$/)).to.deep.equal(["after"]);
        });

        test("does not treat the `>` in `->` as an unexpected closing delimiter", () => {
            const parser = createParser("handler: (Int) -> Void)");

            expect(parser.skipUntil(")")).to.equal(")");
        });

        test("ignores characters inside string literals, including escaped quotes", () => {
            const parser = createParser('a: String = "x, \\"y)\\", z", b: Int)');

            expect(parser.skipUntil(",)")).to.equal(",");
            expect(parser.match(/^(\w+):/)).to.deep.equal(["b"]);
        });

        test("ignores closing delimiters inside string literals", () => {
            const parser = createParser('a: String = "})]", b: Int)');

            expect(parser.skipUntil(",)")).to.equal(",");
            expect(parser.match(/^(\w+):/)).to.deep.equal(["b"]);
        });

        test("continues searching on subsequent lines", () => {
            const parser = createParser(
                "func foo(\n    bar: Int,\n\n    baz: (\n        Int\n    )\n) {}"
            );

            expect(parser.match(/^func foo\(/)).to.deep.equal([]);
            expect(parser.skipUntil(",)")).to.equal(",");
            expect(parser.match(/^(\w+):/)).to.deep.equal(["baz"]);
            expect(parser.skipUntil(",)")).to.equal(")");
            expect(parser.match(/^(\{)/)).to.deep.equal(["{"]);
        });

        test("returns undefined when an unexpected closing delimiter is found", () => {
            expect(createParser("bar: Int] baz)").skipUntil(",)")).to.be.undefined;
            expect(createParser("bar: Int} baz)").skipUntil(",)")).to.be.undefined;
            expect(createParser("bar: (Int]) baz)").skipUntil(",)")).to.be.undefined;
        });

        test("returns undefined when the end of the document is reached", () => {
            const parser = createParser("func foo(bar: Int\n\n");

            expect(parser.match(/^func foo\(/)).to.deep.equal([]);
            expect(parser.skipUntil(",)")).to.be.undefined;
        });
    });
});
