//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
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
import { FileNode, PackageNode } from "../../../src/ui/PackageDependencyProvider";

suite("PackageDependencyProvider Unit Test Suite", function () {
    suite("FileNode", () => {
        test("toTreeItem, file", () => {
            const node = new FileNode("Foo", "/path/to/Foo", false);
            const item = node.toTreeItem();

            const expectedUri = vscode.Uri.file("/path/to/Foo");
            expect(item.label).to.equal("Foo");
            expect(item.resourceUri).to.deep.equal(expectedUri);
            expect(item.command).to.deep.equal({
                command: "vscode.open",
                arguments: [expectedUri],
                title: "Open File",
            });
        });

        test("toTreeItem, Directory", () => {
            const node = new FileNode("Foo", "/path/to/Foo", true);
            const item = node.toTreeItem();

            const expectedUri = vscode.Uri.file("/path/to/Foo");
            expect(item.label).to.equal("Foo");
            expect(item.resourceUri).to.deep.equal(expectedUri);
            expect(item.command).to.be.undefined;
        });
    });

    suite("PackageNode", () => {
        test("toTreeItem", () => {
            const node = new PackageNode(
                "SwiftMarkdown",
                "/path/to/.build/swift-markdown",
                "https://github.com/swiftlang/swift-markdown.git",
                "1.2.3",
                "remote"
            );
            const item = node.toTreeItem();

            expect(item.label).to.equal("SwiftMarkdown");
            expect(item.description).to.deep.equal("1.2.3");
            expect(item.command).to.be.undefined;
        });
    });
});
