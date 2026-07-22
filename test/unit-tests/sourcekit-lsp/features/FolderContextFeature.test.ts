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
import {
    ClientCapabilities,
    DidChangeWorkspaceFoldersNotification,
    InitializeParams,
    State,
    WorkspaceFoldersRequest,
} from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/node";

import { FolderContext } from "@src/FolderContext";
import { FolderContextFeature } from "@src/sourcekit-lsp/client/features/FolderContextFeature";

import { MockedObject, instance, mockFn, mockObject } from "../../../MockUtils";

suite("FolderContextFeature Unit Tests", () => {
    let mockedClient: MockedObject<LanguageClient>;
    let onRequestHandlers: Map<any, (...args: any[]) => any>;
    let feature: FolderContextFeature;

    function mockFolder(name: string, fsPath: string): MockedObject<FolderContext> {
        return mockObject<FolderContext>({
            name,
            folder: vscode.Uri.file(fsPath),
        });
    }

    setup(() => {
        onRequestHandlers = new Map();
        mockedClient = mockObject<LanguageClient>({
            state: State.Stopped,
            sendNotification: mockFn(s => s.resolves()),
            onRequest: mockFn(s =>
                s.callsFake((type, handler) => {
                    onRequestHandlers.set(type, handler);
                    return { dispose: () => onRequestHandlers.delete(type) };
                })
            ),
        });
        feature = new FolderContextFeature(instance(mockedClient));
    });

    teardown(() => {
        feature.clear();
    });

    test("fillClientCapabilities advertises workspaceFolders support", () => {
        const capabilities: ClientCapabilities = {};
        feature.fillClientCapabilities(capabilities);
        expect(capabilities.workspace?.workspaceFolders).to.equal(true);
    });

    test("fillClientCapabilities preserves existing workspace capabilities", () => {
        const capabilities: ClientCapabilities = { workspace: { applyEdit: true } };
        feature.fillClientCapabilities(capabilities);
        expect(capabilities.workspace).to.deep.equal({
            applyEdit: true,
            workspaceFolders: true,
        });
    });

    test("fillInitializeParams uses the currently added folders", async () => {
        const folder = mockFolder("MyApp", "/tmp/MyApp");
        await feature.addFolder(instance(folder));

        const params = {} as InitializeParams;
        feature.fillInitializeParams(params);

        expect(params.workspaceFolders).to.deep.equal([
            { name: "MyApp", uri: vscode.Uri.file("/tmp/MyApp").toString() },
        ]);
    });

    test("fillInitializeParams returns an empty list when no folders are added", () => {
        const params = {} as InitializeParams;
        feature.fillInitializeParams(params);
        expect(params.workspaceFolders).to.deep.equal([]);
    });

    test("initialize registers a WorkspaceFoldersRequest handler that returns the current folders", async () => {
        feature.initialize();
        const folder = mockFolder("MyApp", "/tmp/MyApp");
        await feature.addFolder(instance(folder));

        const handler = onRequestHandlers.get(WorkspaceFoldersRequest.type);
        expect(handler, "expected a WorkspaceFoldersRequest handler to be registered").to.exist;

        const result = handler!();
        expect(result).to.deep.equal([
            { name: "MyApp", uri: vscode.Uri.file("/tmp/MyApp").toString() },
        ]);
    });

    test("addFolder does not send a notification when the client is not running", async () => {
        mockedClient.state = State.Stopped;
        const folder = mockFolder("MyApp", "/tmp/MyApp");

        await feature.addFolder(instance(folder));

        expect(mockedClient.sendNotification).to.not.have.been.called;
        expect(feature.addedFolders).to.have.length(1);
    });

    test("addFolder sends a DidChangeWorkspaceFolders notification when the client is running", async () => {
        mockedClient.state = State.Running;
        const folder = mockFolder("MyApp", "/tmp/MyApp");

        await feature.addFolder(instance(folder));

        expect(mockedClient.sendNotification).to.have.been.calledOnceWithExactly(
            DidChangeWorkspaceFoldersNotification.type,
            {
                event: {
                    added: [{ name: "MyApp", uri: vscode.Uri.file("/tmp/MyApp").toString() }],
                    removed: [],
                },
            }
        );
    });

    test("addFolder is a no-op when the same folder is added twice", async () => {
        mockedClient.state = State.Running;
        const folder = mockFolder("MyApp", "/tmp/MyApp");

        await feature.addFolder(instance(folder));
        await feature.addFolder(instance(folder));

        expect(feature.addedFolders).to.have.length(1);
        expect(mockedClient.sendNotification).to.have.been.calledOnce;
    });

    test("removeFolder removes a previously added folder", async () => {
        mockedClient.state = State.Stopped;
        const folder = mockFolder("MyApp", "/tmp/MyApp");
        await feature.addFolder(instance(folder));
        expect(feature.addedFolders).to.have.length(1);

        await feature.removeFolder(instance(folder));
        expect(feature.addedFolders).to.have.length(0);
    });

    test("removeFolder sends a DidChangeWorkspaceFolders notification when the client is running", async () => {
        mockedClient.state = State.Running;
        const folder = mockFolder("MyApp", "/tmp/MyApp");
        await feature.addFolder(instance(folder));
        mockedClient.sendNotification.resetHistory();

        await feature.removeFolder(instance(folder));

        expect(mockedClient.sendNotification).to.have.been.calledOnceWithExactly(
            DidChangeWorkspaceFoldersNotification.type,
            {
                event: {
                    added: [],
                    removed: [{ name: "MyApp", uri: vscode.Uri.file("/tmp/MyApp").toString() }],
                },
            }
        );
    });

    test("removeFolder is a no-op when the folder was never added", async () => {
        mockedClient.state = State.Running;
        const folder = mockFolder("Phantom", "/tmp/Phantom");

        await feature.removeFolder(instance(folder));

        expect(mockedClient.sendNotification).to.not.have.been.called;
    });

    test("clear() disposes registered request handlers", () => {
        feature.initialize();
        expect(onRequestHandlers.has(WorkspaceFoldersRequest.type)).to.be.true;

        feature.clear();

        expect(onRequestHandlers.has(WorkspaceFoldersRequest.type)).to.be.false;
    });
});
