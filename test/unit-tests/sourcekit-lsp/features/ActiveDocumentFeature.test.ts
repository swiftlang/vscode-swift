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
import { ClientCapabilities, Code2ProtocolConverter, State } from "vscode-languageclient";

import { SourceKitLanguageClient } from "@src/sourcekit-lsp/client/SourceKitLanguageClient";
import { ActiveDocumentFeature } from "@src/sourcekit-lsp/client/features/ActiveDocumentFeature";
import { DidChangeActiveDocumentNotification } from "@src/sourcekit-lsp/extensions/DidChangeActiveDocumentRequest";
import { Version } from "@src/utilities/version";

import {
    AsyncEventEmitter,
    MockedObject,
    instance,
    mockFn,
    mockGlobalEvent,
    mockGlobalValue,
    mockObject,
} from "../../../MockUtils";

suite("ActiveDocumentFeature Unit Tests", () => {
    const onDidChangeActiveTextEditor = mockGlobalEvent(
        vscode.window,
        "onDidChangeActiveTextEditor"
    );
    const activeTextEditorMock = mockGlobalValue(vscode.window, "activeTextEditor");

    let mockedClient: MockedObject<SourceKitLanguageClient>;
    let onDidChangeState: AsyncEventEmitter<{ oldState: State; newState: State }>;
    let feature: ActiveDocumentFeature;

    function mockDocument(uri: string): vscode.TextDocument {
        return instance(
            mockObject<vscode.TextDocument>({
                uri: vscode.Uri.parse(uri),
            })
        );
    }

    function mockEditor(document: vscode.TextDocument): vscode.TextEditor {
        return instance(mockObject<vscode.TextEditor>({ document }));
    }

    setup(() => {
        onDidChangeState = new AsyncEventEmitter();
        mockedClient = mockObject<SourceKitLanguageClient>({
            swiftVersion: new Version(6, 4, 0),
            code2ProtocolConverter: instance(
                mockObject<Code2ProtocolConverter>({
                    asTextDocumentIdentifier: mockFn(s =>
                        s.callsFake(doc => ({ uri: doc.uri.toString() }))
                    ),
                })
            ),
            sendNotification: mockFn(s => s.resolves()) as any,
            onDidChangeState: mockFn(s => s.callsFake(onDidChangeState.event)) as any,
        });
        feature = new ActiveDocumentFeature(instance(mockedClient));
    });

    teardown(() => {
        feature.clear();
    });

    test("advertises to the server that it supports the active document notification (Swift <6.3.0)", () => {
        mockedClient.swiftVersion = new Version(6, 2, 99);
        const capabilities: ClientCapabilities = {};
        feature.fillClientCapabilities(capabilities);
        expect(capabilities)
            .to.have.property("experimental")
            .that.deep.equals({
                [DidChangeActiveDocumentNotification.method]: true,
            });
    });

    test("advertises to the server that it supports the active document notification (Swift >=6.3.0)", () => {
        mockedClient.swiftVersion = new Version(6, 3, 0);
        const capabilities: ClientCapabilities = {};
        feature.fillClientCapabilities(capabilities);
        expect(capabilities)
            .to.have.property("experimental")
            .that.deep.equals({
                [DidChangeActiveDocumentNotification.method]: {
                    supported: true,
                },
            });
    });

    test("does nothing when the server does not support the experimental capability", () => {
        feature.initialize({});
        expect(mockedClient.sendNotification).to.not.have.been.called;
        expect(mockedClient.onDidChangeState).to.not.have.been.called;
    });

    test("sends a notification on initialize when the active editor is set", () => {
        const document = mockDocument("file:///main.swift");
        activeTextEditorMock.setValue(mockEditor(document));

        feature.initialize({
            experimental: {
                [DidChangeActiveDocumentNotification.method]: { version: 1 },
            },
        });

        expect(mockedClient.sendNotification).to.have.been.calledOnceWithExactly(
            DidChangeActiveDocumentNotification.method,
            { textDocument: { uri: "file:///main.swift" } }
        );
    });

    test("sends nothing on initialize when there is no active editor", () => {
        activeTextEditorMock.setValue(undefined);

        feature.initialize({
            experimental: {
                [DidChangeActiveDocumentNotification.method]: { version: 1 },
            },
        });

        expect(mockedClient.sendNotification).to.not.have.been.called;
    });

    test("sends a notification when the active editor changes", async () => {
        activeTextEditorMock.setValue(undefined);
        feature.initialize({
            experimental: {
                [DidChangeActiveDocumentNotification.method]: { version: 1 },
            },
        });
        mockedClient.sendNotification.resetHistory();

        const document = mockDocument("file:///changed.swift");
        await onDidChangeActiveTextEditor.fire(mockEditor(document));

        expect(mockedClient.sendNotification).to.have.been.calledOnceWithExactly(
            DidChangeActiveDocumentNotification.method,
            { textDocument: { uri: "file:///changed.swift" } }
        );
    });

    test("does not send another null notification when the editor is already closed", async () => {
        activeTextEditorMock.setValue(undefined);
        feature.initialize({
            experimental: {
                [DidChangeActiveDocumentNotification.method]: { version: 1 },
            },
        });
        mockedClient.sendNotification.resetHistory();

        await onDidChangeActiveTextEditor.fire(undefined);

        expect(mockedClient.sendNotification).to.not.have.been.called;
    });

    test("sends a null notification when the active editor is closed", async () => {
        const document = mockDocument("file:///open.swift");
        activeTextEditorMock.setValue(mockEditor(document));
        feature.initialize({
            experimental: {
                [DidChangeActiveDocumentNotification.method]: { version: 1 },
            },
        });
        mockedClient.sendNotification.resetHistory();

        await onDidChangeActiveTextEditor.fire(undefined);

        expect(mockedClient.sendNotification).to.have.been.calledOnceWithExactly(
            DidChangeActiveDocumentNotification.method,
            { textDocument: null }
        );
    });

    test("re-sends the active document notification when the client transitions to running", async () => {
        const document = mockDocument("file:///running.swift");
        activeTextEditorMock.setValue(mockEditor(document));
        feature.initialize({
            experimental: {
                [DidChangeActiveDocumentNotification.method]: { version: 1 },
            },
        });
        mockedClient.sendNotification.resetHistory();

        await onDidChangeState.fire({ oldState: State.Running, newState: State.Stopped });
        await onDidChangeState.fire({ oldState: State.Starting, newState: State.Running });

        expect(mockedClient.sendNotification).to.have.been.calledOnceWithExactly(
            DidChangeActiveDocumentNotification.method,
            { textDocument: { uri: "file:///running.swift" } }
        );
    });

    test("clear() disposes subscriptions and resets internal state", async () => {
        const document = mockDocument("file:///cleared.swift");
        activeTextEditorMock.setValue(mockEditor(document));
        feature.initialize({
            experimental: {
                [DidChangeActiveDocumentNotification.method]: { version: 1 },
            },
        });
        mockedClient.sendNotification.resetHistory();

        feature.clear();

        // After clear, the editor change listener should no longer fire notifications.
        await onDidChangeActiveTextEditor.fire(mockEditor(mockDocument("file:///after.swift")));
        expect(mockedClient.sendNotification).to.not.have.been.called;
    });
});
