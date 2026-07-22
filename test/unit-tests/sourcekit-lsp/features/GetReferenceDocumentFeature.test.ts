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
import { ClientCapabilities, Code2ProtocolConverter } from "vscode-languageclient/node";

import { SourceKitLanguageClient } from "@src/sourcekit-lsp/client/SourceKitLanguageClient";
import { GetReferenceDocumentFeature } from "@src/sourcekit-lsp/client/features/GetReferenceDocumentFeature";
import { GetReferenceDocumentRequest } from "@src/sourcekit-lsp/extensions";
import { Version } from "@src/utilities/version";

import { MockedObject, instance, mockFn, mockGlobalFunction, mockObject } from "../../../MockUtils";

suite("GetReferenceDocumentFeature Unit Tests", () => {
    const registerTextDocumentContentProviderMock = mockGlobalFunction(
        vscode.workspace,
        "registerTextDocumentContentProvider"
    );

    let mockedClient: MockedObject<SourceKitLanguageClient>;
    let registeredProvider: vscode.TextDocumentContentProvider | undefined;
    let registeredScheme: string | undefined;
    let providerDisposed: boolean;
    let feature: GetReferenceDocumentFeature;

    setup(() => {
        registeredProvider = undefined;
        registeredScheme = undefined;
        providerDisposed = false;
        registerTextDocumentContentProviderMock.callsFake(
            (scheme: string, provider: vscode.TextDocumentContentProvider) => {
                registeredScheme = scheme;
                registeredProvider = provider;
                return {
                    dispose: () => {
                        providerDisposed = true;
                    },
                };
            }
        );
        mockedClient = mockObject<SourceKitLanguageClient>({
            swiftVersion: new Version(6, 4, 0),
            code2ProtocolConverter: instance(
                mockObject<Code2ProtocolConverter>({
                    asUri: mockFn(s => s.callsFake(uri => uri.toString())),
                })
            ),
            sendRequest: mockFn(),
        });
        feature = new GetReferenceDocumentFeature(instance(mockedClient));
    });

    teardown(() => {
        feature.clear();
    });

    test("advertises to the server that it supports the get reference document request (Swift <6.3.0)", () => {
        mockedClient.swiftVersion = new Version(6, 2, 99);
        const capabilities: ClientCapabilities = {};
        feature.fillClientCapabilities(capabilities);
        expect(capabilities)
            .to.have.property("experimental")
            .that.deep.equals({
                [GetReferenceDocumentRequest.method]: true,
            });
    });

    test("advertises to the server that it supports the get reference document request (Swift >=6.3.0)", () => {
        mockedClient.swiftVersion = new Version(6, 3, 0);
        const capabilities: ClientCapabilities = {};
        feature.fillClientCapabilities(capabilities);
        expect(capabilities)
            .to.have.property("experimental")
            .that.deep.equals({
                [GetReferenceDocumentRequest.method]: {
                    supported: true,
                },
            });
    });

    test("returns a static feature state", () => {
        expect(feature.getState()).to.deep.equal({ kind: "static" });
    });

    test("initialize registers a TextDocumentContentProvider for the sourcekit-lsp scheme", () => {
        feature.initialize();

        expect(registerTextDocumentContentProviderMock).to.have.been.calledOnce;
        expect(registeredScheme).to.equal("sourcekit-lsp");
        expect(registeredProvider).to.exist;
    });

    test("provideTextDocumentContent forwards the URI as a GetReferenceDocumentRequest", async () => {
        feature.initialize();
        mockedClient.sendRequest.resolves({ content: "Hello, world!" });

        const uri = vscode.Uri.parse("sourcekit-lsp:///Foo.swift");
        const cancellation = new vscode.CancellationTokenSource().token;
        const result = await registeredProvider!.provideTextDocumentContent(uri, cancellation);

        expect(result).to.equal("Hello, world!");
        expect(mockedClient.sendRequest).to.have.been.calledOnceWithExactly(
            GetReferenceDocumentRequest.type,
            { uri: uri.toString() },
            cancellation
        );
    });

    test("provideTextDocumentContent returns a fallback message when the server returns nothing", async () => {
        feature.initialize();
        mockedClient.sendRequest.resolves(undefined);

        const uri = vscode.Uri.parse("sourcekit-lsp:///Empty.swift");
        const result = await registeredProvider!.provideTextDocumentContent(
            uri,
            new vscode.CancellationTokenSource().token
        );

        expect(result).to.equal("Unable to retrieve reference document");
    });

    test("clear() disposes the registered provider", () => {
        feature.initialize();
        expect(providerDisposed).to.be.false;

        feature.clear();

        expect(providerDisposed).to.be.true;
    });
});
