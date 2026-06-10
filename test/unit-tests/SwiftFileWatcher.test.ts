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
import { stub } from "sinon";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { FileOperation, SwiftFileEvent } from "@src/SwiftExtensionApi";
import { SwiftFileWatcher } from "@src/SwiftFileWatcher";

import { instance, mockGlobalObject, mockObject } from "../MockUtils";

suite("SwiftFileWatcher Suite", () => {
    const workspaceMock = mockGlobalObject(vscode, "workspace");
    let folder: vscode.Uri;
    let createEmitter: vscode.EventEmitter<vscode.Uri>;
    let changeEmitter: vscode.EventEmitter<vscode.Uri>;
    let deleteEmitter: vscode.EventEmitter<vscode.Uri>;
    let disposeStub: ReturnType<typeof stub>;
    let onChange: ReturnType<typeof stub>;
    let watcher: SwiftFileWatcher;

    setup(() => {
        folder = vscode.Uri.file("/path/to/pkg");
        createEmitter = new vscode.EventEmitter<vscode.Uri>();
        changeEmitter = new vscode.EventEmitter<vscode.Uri>();
        deleteEmitter = new vscode.EventEmitter<vscode.Uri>();
        disposeStub = stub();
        workspaceMock.createFileSystemWatcher.returns({
            onDidCreate: createEmitter.event,
            onDidChange: changeEmitter.event,
            onDidDelete: deleteEmitter.event,
            dispose: disposeStub,
            ignoreCreateEvents: false,
            ignoreChangeEvents: false,
            ignoreDeleteEvents: false,
        });
        const folderContext = mockObject<FolderContext>({ folder });
        onChange = stub();
        watcher = new SwiftFileWatcher(
            instance(folderContext),
            onChange as (event: SwiftFileEvent) => void
        );
    });

    teardown(() => {
        watcher.dispose();
    });

    test("scopes the watcher to the folder with a **/*.swift relative pattern", () => {
        expect(workspaceMock.createFileSystemWatcher).to.have.been.calledOnce;
        const pattern = workspaceMock.createFileSystemWatcher.firstCall.args[0];
        expect(pattern).to.be.instanceOf(vscode.RelativePattern);
        const relativePattern = pattern as vscode.RelativePattern;
        expect(relativePattern.baseUri.fsPath).to.equal(folder.fsPath);
        expect(relativePattern.pattern).to.equal("**/*.swift");
    });

    test("fires a created event when a swift file is created", () => {
        const uri = vscode.Uri.file("/path/to/pkg/Sources/main.swift");
        createEmitter.fire(uri);
        expect(onChange).to.have.been.calledOnceWith({ uri, operation: FileOperation.created });
    });

    test("fires a changed event when a swift file is changed", () => {
        const uri = vscode.Uri.file("/path/to/pkg/Sources/main.swift");
        changeEmitter.fire(uri);
        expect(onChange).to.have.been.calledOnceWith({ uri, operation: FileOperation.changed });
    });

    test("fires a deleted event when a swift file is deleted", () => {
        const uri = vscode.Uri.file("/path/to/pkg/Sources/main.swift");
        deleteEmitter.fire(uri);
        expect(onChange).to.have.been.calledOnceWith({ uri, operation: FileOperation.deleted });
    });

    test("disposes the underlying watcher", () => {
        watcher.dispose();
        expect(disposeStub).to.have.been.called;
    });
});
