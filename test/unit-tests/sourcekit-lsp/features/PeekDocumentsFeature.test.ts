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
import { ClientCapabilities, Protocol2CodeConverter } from "vscode-languageclient/node";

import { SourceKitLanguageClient } from "@src/sourcekit-lsp/client/SourceKitLanguageClient";
import { PeekDocumentsFeature } from "@src/sourcekit-lsp/client/features/PeekDocumentsFeature";
import {
    PeekDocumentsParams,
    PeekDocumentsRequest,
    PeekDocumentsResponse,
} from "@src/sourcekit-lsp/extensions";
import { Version } from "@src/utilities/version";

import { MockedObject, instance, mockFn, mockGlobalFunction, mockObject } from "../../../MockUtils";

suite("PeekDocumentsFeature Unit Tests", () => {
    const executeCommandMock = mockGlobalFunction(vscode.commands, "executeCommand");

    let mockedClient: MockedObject<SourceKitLanguageClient>;
    let onRequestHandlers: Map<
        string,
        (params: PeekDocumentsParams) => Promise<PeekDocumentsResponse>
    >;
    let feature: PeekDocumentsFeature;

    setup(() => {
        executeCommandMock.resolves(undefined);
        onRequestHandlers = new Map();
        mockedClient = mockObject<SourceKitLanguageClient>({
            swiftVersion: new Version(6, 4, 0),
            protocol2CodeConverter: instance(
                mockObject<Protocol2CodeConverter>({
                    asUri: mockFn(s => s.callsFake(uri => vscode.Uri.parse(uri))),
                    asLocation: mockFn(s =>
                        s.callsFake(
                            location =>
                                new vscode.Location(
                                    vscode.Uri.parse(location.uri),
                                    new vscode.Range(
                                        new vscode.Position(
                                            location.range.start.line,
                                            location.range.start.character
                                        ),
                                        new vscode.Position(
                                            location.range.end.line,
                                            location.range.end.character
                                        )
                                    )
                                )
                        )
                    ),
                })
            ),
            onRequest: mockFn(s =>
                s.callsFake((method, handler) => {
                    onRequestHandlers.set(method, handler);
                    return { dispose: () => onRequestHandlers.delete(method) };
                })
            ),
        });
        feature = new PeekDocumentsFeature(instance(mockedClient));
    });

    teardown(() => {
        feature.clear();
    });

    function invokeHandler(params: PeekDocumentsParams): Promise<PeekDocumentsResponse> {
        const handler = onRequestHandlers.get(PeekDocumentsRequest.method);
        expect(handler, "expected a PeekDocumentsRequest handler to be registered").to.exist;
        return handler!(params);
    }

    test("returns a static feature state", () => {
        expect(feature.getState()).to.deep.equal({ kind: "static" });
    });

    test("advertises to the server that it supports the peek documents request (Swift <6.3.0)", () => {
        mockedClient.swiftVersion = new Version(6, 2, 99);
        const capabilities: ClientCapabilities = {};
        feature.fillClientCapabilities(capabilities);
        expect(capabilities)
            .to.have.property("experimental")
            .that.deep.equals({
                [PeekDocumentsRequest.method]: true,
            });
    });

    test("advertises to the server that it supports the peek documents request (Swift >=6.3.0)", () => {
        mockedClient.swiftVersion = new Version(6, 3, 0);
        const capabilities: ClientCapabilities = {};
        feature.fillClientCapabilities(capabilities);
        expect(capabilities)
            .to.have.property("experimental")
            .that.deep.equals({
                [PeekDocumentsRequest.method]: {
                    supported: true,
                    peekLocation: true,
                },
            });
    });

    test("initialize registers a request handler for PeekDocumentsRequest", () => {
        feature.initialize();

        expect(mockedClient.onRequest).to.have.been.calledOnce;
        expect(onRequestHandlers.has(PeekDocumentsRequest.method)).to.be.true;
    });

    test("returns success when invoked with no locations", async () => {
        feature.initialize();

        const result = await invokeHandler({
            uri: "file:///main.swift",
            position: { line: 0, character: 0 },
            locations: [],
        });

        expect(result).to.deep.equal({ success: true });
    });

    test("converts DocumentUri locations into vscode.Location values at line 0, character 0", async () => {
        feature.initialize();

        await invokeHandler({
            uri: "file:///main.swift",
            position: { line: 4, character: 2 },
            locations: ["file:///foo.swift", "file:///bar.swift"],
        });

        // The second call to executeCommand carries the real locations (the first is the dummy
        // peek used to close any previously-shown peek window).
        expect(executeCommandMock.callCount).to.equal(2);
        const realCallArgs = executeCommandMock.secondCall.args;
        expect(realCallArgs[0]).to.equal("editor.action.peekLocations");
        const locations = realCallArgs[3] as vscode.Location[];
        expect(locations).to.have.length(2);
        expect(locations[0].uri.toString()).to.equal("file:///foo.swift");
        expect(locations[0].range.start.line).to.equal(0);
        expect(locations[0].range.start.character).to.equal(0);
        expect(locations[1].uri.toString()).to.equal("file:///bar.swift");
    });

    test("converts Location-typed entries through protocol2CodeConverter.asLocation", async () => {
        feature.initialize();

        await invokeHandler({
            uri: "file:///main.swift",
            position: { line: 1, character: 1 },
            locations: [
                {
                    uri: "file:///referenced.swift",
                    range: {
                        start: { line: 7, character: 4 },
                        end: { line: 7, character: 8 },
                    },
                },
            ],
        });

        const realCallArgs = executeCommandMock.secondCall.args;
        const locations = realCallArgs[3] as vscode.Location[];
        expect(locations).to.have.length(1);
        expect(locations[0].uri.toString()).to.equal("file:///referenced.swift");
        expect(locations[0].range.start.line).to.equal(7);
        expect(locations[0].range.start.character).to.equal(4);
        expect(locations[0].range.end.line).to.equal(7);
        expect(locations[0].range.end.character).to.equal(8);
    });

    test("first executes a dummy peek at a different position to close any previous peek", async () => {
        feature.initialize();

        await invokeHandler({
            uri: "file:///main.swift",
            position: { line: 5, character: 3 },
            locations: [],
        });

        expect(executeCommandMock.callCount).to.equal(2);
        const dummyArgs = executeCommandMock.firstCall.args;
        expect(dummyArgs[0]).to.equal("editor.action.peekLocations");
        const dummyPosition = dummyArgs[2] as vscode.Position;
        // For character != 0, the dummy peek position is one column earlier.
        expect(dummyPosition.line).to.equal(5);
        expect(dummyPosition.character).to.equal(2);
        expect(dummyArgs[3]).to.have.length(1);
        expect(dummyArgs[4]).to.equal("peek");
    });

    test("dummy peek uses character 1 when the requested position is at character 0", async () => {
        feature.initialize();

        await invokeHandler({
            uri: "file:///main.swift",
            position: { line: 0, character: 0 },
            locations: [],
        });

        const dummyArgs = executeCommandMock.firstCall.args;
        const dummyPosition = dummyArgs[2] as vscode.Position;
        expect(dummyPosition.line).to.equal(0);
        expect(dummyPosition.character).to.equal(1);
    });

    test("real peek is invoked at the requested position", async () => {
        feature.initialize();

        await invokeHandler({
            uri: "file:///main.swift",
            position: { line: 12, character: 6 },
            locations: ["file:///foo.swift"],
        });

        const realArgs = executeCommandMock.secondCall.args;
        expect(realArgs[0]).to.equal("editor.action.peekLocations");
        expect((realArgs[1] as vscode.Uri).toString()).to.equal("file:///main.swift");
        const position = realArgs[2] as vscode.Position;
        expect(position.line).to.equal(12);
        expect(position.character).to.equal(6);
        expect(realArgs[4]).to.equal("peek");
    });

    test("clear() disposes the registered request handler", () => {
        feature.initialize();
        expect(onRequestHandlers.has(PeekDocumentsRequest.method)).to.be.true;

        feature.clear();

        expect(onRequestHandlers.has(PeekDocumentsRequest.method)).to.be.false;
    });
});
