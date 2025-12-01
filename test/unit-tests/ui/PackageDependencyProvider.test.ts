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
import * as fs from "fs/promises";
import * as vscode from "vscode";

import { FileNode, PackageNode } from "@src/ui/ProjectPanelProvider";

import { mockGlobalModule } from "../../MockUtils";

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
                {
                    identity: "SwiftMarkdown",
                    path: "/path/to/.build/swift-markdown",
                    location: "https://github.com/swiftlang/swift-markdown.git",
                    dependencies: [],
                    version: "1.2.3",
                    type: "remote",
                },
                () => []
            );
            const item = node.toTreeItem();

            expect(item.label).to.equal("SwiftMarkdown");
            expect(item.description).to.deep.equal("1.2.3");
            expect(item.command).to.be.undefined;
        });

        const fsMock = mockGlobalModule(fs);

        test("enumerates child dependencies and files", async () => {
            fsMock.stat.resolves({ isFile: () => true, isDirectory: () => false } as any);

            const node = new PackageNode(
                {
                    identity: "SwiftMarkdown",
                    path: "/path/to/.build/swift-markdown",
                    location: "https://github.com/swiftlang/swift-markdown.git",
                    dependencies: [],
                    version: "1.2.3",
                    type: "remote",
                },
                () => [
                    {
                        identity: "SomeChildDependency",
                        path: "/path/to/.build/child-dependency",
                        location: "https://github.com/swiftlang/some-child-dependency.git",
                        dependencies: [],
                        version: "1.2.4",
                        type: "remote",
                    },
                ],
                undefined,
                () =>
                    Promise.resolve([
                        "/path/to/.build/swift-markdown/file1",
                        "/path/to/.build/swift-markdown/file2",
                    ])
            );

            const children = await node.getChildren();

            expect(children).to.have.lengthOf(3);
            const [childDep, ...childFiles] = children;
            expect(childDep.name).to.equal("SomeChildDependency");
            expect(childFiles).to.have.lengthOf(2);

            childFiles.forEach((file, index) => {
                if (!(file instanceof FileNode)) {
                    throw new Error(`Expected FileNode, got ${file.constructor.name}`);
                }

                const expectedName = `file${index + 1}`;
                const expectedPath = `/path/to/.build/swift-markdown/file${index + 1}`;

                expect(file.name).to.equal(expectedName, `File name should be file${index + 1}`);
                expect(file.path).to.equalPath(expectedPath);
                expect(file.isDirectory).to.be.false;
            });
        });
    });
});
