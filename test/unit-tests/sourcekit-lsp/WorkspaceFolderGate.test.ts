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

import { WorkspaceFolderGate } from "@src/sourcekit-lsp/WorkspaceFolderGate";

suite("WorkspaceFolderGate Suite", () => {
    const rootUri = vscode.Uri.file("/root/project");
    const subfolderUri = vscode.Uri.file("/root/project/subfolder");
    const otherUri = vscode.Uri.file("/other/project");

    function createGate(): WorkspaceFolderGate {
        return new WorkspaceFolderGate(rootUri);
    }

    suite("waitForFolder", () => {
        test("resolves immediately for documents inside the root folder", async () => {
            const gate = createGate();
            const documentUri = vscode.Uri.file("/root/project/Sources/main.swift");
            await gate.waitForFolder(documentUri);
        });

        test("resolves immediately for documents inside a known subfolder", async () => {
            const gate = createGate();
            gate.folderAdded(subfolderUri);
            const documentUri = vscode.Uri.file("/root/project/subfolder/file.swift");
            await gate.waitForFolder(documentUri);
        });

        test("waits and resolves when the containing folder is added", async () => {
            const gate = createGate();
            const documentUri = vscode.Uri.file("/other/project/Sources/file.swift");

            const promise = gate.waitForFolder(documentUri);
            gate.folderAdded(otherUri);

            await promise;
        });

        test("times out when the containing folder is never added", async () => {
            const gate = createGate();
            const documentUri = vscode.Uri.file("/other/project/Sources/file.swift");

            await gate.waitForFolder(documentUri, 50);
        });

        test("resolves via cancellation token", async () => {
            const gate = createGate();
            const documentUri = vscode.Uri.file("/other/project/Sources/file.swift");
            const tokenSource = new vscode.CancellationTokenSource();

            const promise = gate.waitForFolder(documentUri, 30000, tokenSource.token);
            tokenSource.cancel();

            await promise;
            tokenSource.dispose();
        });

        test("resolves multiple pending requests when a folder is added", async () => {
            const gate = createGate();
            const doc1 = vscode.Uri.file("/other/project/Sources/a.swift");
            const doc2 = vscode.Uri.file("/other/project/Sources/b.swift");

            const promise1 = gate.waitForFolder(doc1);
            const promise2 = gate.waitForFolder(doc2);
            gate.folderAdded(otherUri);

            await Promise.all([promise1, promise2]);
        });

        test("does not resolve requests for unrelated folders", async () => {
            const gate = createGate();
            const documentUri = vscode.Uri.file("/other/project/Sources/file.swift");
            const unrelatedUri = vscode.Uri.file("/unrelated/folder");

            let resolved = false;
            const promise = gate.waitForFolder(documentUri, 100).then(() => {
                resolved = true;
            });

            gate.folderAdded(unrelatedUri);

            await new Promise(resolve => setTimeout(resolve, 50));
            expect(resolved).to.be.false;

            gate.folderAdded(otherUri);
            await promise;
            expect(resolved).to.be.true;
        });
    });

    suite("folderRemoved", () => {
        test("removes a known folder so documents inside it must wait again", async () => {
            const gate = createGate();
            gate.folderAdded(otherUri);
            gate.folderRemoved(otherUri);

            const documentUri = vscode.Uri.file("/other/project/Sources/file.swift");
            let resolved = false;
            const promise = gate.waitForFolder(documentUri, 100).then(() => {
                resolved = true;
            });

            await new Promise(resolve => setTimeout(resolve, 50));
            expect(resolved).to.be.false;

            gate.folderAdded(otherUri);
            await promise;
            expect(resolved).to.be.true;
        });
    });

    suite("dispose", () => {
        test("resolves all pending requests on dispose", async () => {
            const gate = createGate();
            const doc1 = vscode.Uri.file("/other/project/Sources/a.swift");
            const doc2 = vscode.Uri.file("/third/project/Sources/b.swift");

            const promise1 = gate.waitForFolder(doc1);
            const promise2 = gate.waitForFolder(doc2);

            gate.dispose();

            await Promise.all([promise1, promise2]);
        });
    });
});
