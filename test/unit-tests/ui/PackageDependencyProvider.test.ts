//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 Apple Inc. and the VS Code Swift project authors
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
        test("can create a VSCode TreeItem that opens a file", () => {
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

        test("can create a VSCode TreeItem that represents a directory", () => {
            const node = new FileNode("Foo", "/path/to/Foo", true);
            const item = node.toTreeItem();

            const expectedUri = vscode.Uri.file("/path/to/Foo");
            expect(item.label).to.equal("Foo");
            expect(item.resourceUri).to.deep.equal(expectedUri);
            expect(item.command).to.be.undefined;
        });
    });

    suite("PackageNode", () => {
        test("can create a VSCode TreeItem that represents a Swift package", () => {
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
