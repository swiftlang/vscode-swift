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
import * as path from "path";
import { match } from "sinon";
import * as vscode from "vscode";
import {
    Code2ProtocolConverter,
    DidChangeWorkspaceFoldersNotification,
    DidChangeWorkspaceFoldersParams,
    LanguageClient,
    Middleware,
    State,
    StateChangeEvent,
} from "vscode-languageclient/node";

import { FolderContext } from "@src/FolderContext";
import { FolderEvent, FolderOperation, WorkspaceContext } from "@src/WorkspaceContext";
import configuration from "@src/configuration";
import { SwiftLogger } from "@src/logging/SwiftLogger";
import { SwiftLoggerFactory } from "@src/logging/SwiftLoggerFactory";
import { SwiftOutputChannel } from "@src/logging/SwiftOutputChannel";
import { LanguageClientFactory } from "@src/sourcekit-lsp/LanguageClientFactory";
import { LanguageClientManager } from "@src/sourcekit-lsp/LanguageClientManager";
import { LanguageClientToolchainCoordinator } from "@src/sourcekit-lsp/LanguageClientToolchainCoordinator";
import { LSPActiveDocumentManager } from "@src/sourcekit-lsp/didChangeActiveDocument";
import {
    DidChangeActiveDocumentNotification,
    DidChangeActiveDocumentParams,
} from "@src/sourcekit-lsp/extensions/DidChangeActiveDocumentRequest";
import { BuildFlags } from "@src/toolchain/BuildFlags";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Version } from "@src/utilities/version";

import {
    AsyncEventEmitter,
    MockedObject,
    instance,
    mockFn,
    mockGlobalModule,
    mockGlobalObject,
    mockGlobalValue,
    mockObject,
    waitForReturnedPromises,
} from "../../MockUtils";

suite("LanguageClientManager Suite", () => {
    let languageClientFactoryMock: MockedObject<LanguageClientFactory>;
    let languageClientMock: MockedObject<LanguageClient>;
    let mockedConverter: MockedObject<Code2ProtocolConverter>;
    let changeStateEmitter: AsyncEventEmitter<StateChangeEvent>;
    let mockedWorkspace: MockedObject<WorkspaceContext>;
    let mockedFolder: MockedObject<FolderContext>;
    let didChangeFoldersEmitter: AsyncEventEmitter<FolderEvent>;
    let mockLogger: MockedObject<SwiftLogger>;
    let mockLoggerFactory: MockedObject<SwiftLoggerFactory>;
    let mockedToolchain: MockedObject<SwiftToolchain>;
    let mockedBuildFlags: MockedObject<BuildFlags>;

    const mockedConfig = mockGlobalModule(configuration);
    const mockedEnvironment = mockGlobalValue(process, "env");
    const mockedLspConfig = mockGlobalObject(configuration, "lsp");
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");
    const mockedVSCodeExtensions = mockGlobalObject(vscode, "extensions");
    const mockedVSCodeWorkspace = mockGlobalObject(vscode, "workspace");
    const excludeConfig = mockGlobalValue(configuration, "excludePathsFromActivation");
    let changeConfigEmitter: AsyncEventEmitter<vscode.ConfigurationChangeEvent>;
    let createFilesEmitter: AsyncEventEmitter<vscode.FileCreateEvent>;
    let deleteFilesEmitter: AsyncEventEmitter<vscode.FileDeleteEvent>;

    const doesNotHave = (prop: any) =>
        match(function (actual) {
            if (typeof actual === "object") {
                return !(prop in actual);
            }
            return actual[prop] === undefined;
        }, "doesNotHave");

    setup(async () => {
        // Mock pieces of the VSCode API
        mockedVSCodeWindow.activeTextEditor = undefined;
        mockedVSCodeWindow.showInformationMessage.resolves();
        mockedVSCodeExtensions.getExtension.returns(undefined);
        changeConfigEmitter = new AsyncEventEmitter();
        mockedVSCodeWorkspace.onDidChangeConfiguration.callsFake(changeConfigEmitter.event);
        createFilesEmitter = new AsyncEventEmitter();
        mockedVSCodeWorkspace.onDidCreateFiles.callsFake(createFilesEmitter.event);
        deleteFilesEmitter = new AsyncEventEmitter();
        mockedVSCodeWorkspace.onDidDeleteFiles.callsFake(deleteFilesEmitter.event);
        mockedVSCodeWorkspace.getConfiguration
            .withArgs("files")
            .returns({ get: () => ({}) } as any);
        // Mock the WorkspaceContext and SwiftToolchain
        mockedBuildFlags = mockObject<BuildFlags>({
            buildPathFlags: mockFn(s => s.returns([])),
            swiftDriverSDKFlags: mockFn(s => s.returns([])),
            swiftDriverTargetFlags: mockFn(s => s.returns([])),
        });
        mockedToolchain = mockObject<SwiftToolchain>({
            swiftVersion: new Version(6, 0, 0),
            buildFlags: mockedBuildFlags as unknown as BuildFlags,
            getToolchainExecutable: mockFn(s =>
                s.withArgs("sourcekit-lsp").returns("/path/to/toolchain/bin/sourcekit-lsp")
            ),
        });
        mockLogger = mockObject<SwiftLogger>({
            info: s => s,
            debug: s => s,
        });
        mockLoggerFactory = mockObject<SwiftLoggerFactory>({
            create: mockFn(s => s.returns(mockObject<SwiftOutputChannel>({}))),
        });
        didChangeFoldersEmitter = new AsyncEventEmitter();
        mockedFolder = mockObject<FolderContext>({
            isRootFolder: false,
            folder: vscode.Uri.file("/folder1"),
            workspaceFolder: {
                uri: vscode.Uri.file("/folder1"),
                name: "folder1",
                index: 0,
            },
            workspaceContext: instance(
                mockObject<WorkspaceContext>({
                    globalToolchain: instance(mockedToolchain),
                    globalToolchainSwiftVersion: new Version(6, 0, 0),
                    logger: instance(mockLogger),
                    loggerFactory: instance(mockLoggerFactory),
                })
            ),
            swiftVersion: new Version(6, 0, 0),
            toolchain: instance(mockedToolchain),
        });
        mockedWorkspace = mockObject<WorkspaceContext>({
            globalToolchain: instance(mockedToolchain),
            globalToolchainSwiftVersion: new Version(6, 0, 0),
            logger: instance(mockLogger),
            loggerFactory: instance(mockLoggerFactory),
            subscriptions: [],
            folders: [instance(mockedFolder)],
            onDidChangeFolders: mockFn(s => s.callsFake(didChangeFoldersEmitter.event)),
        });
        mockedConverter = mockObject<Code2ProtocolConverter>({
            asUri: mockFn(s => s.callsFake(uri => uri.fsPath)),
            asTextDocumentIdentifier: mockFn(s => s.callsFake(doc => ({ uri: doc.uri.fsPath }))),
        });
        changeStateEmitter = new AsyncEventEmitter();
        languageClientMock = mockObject<LanguageClient>({
            state: State.Stopped,
            code2ProtocolConverter: instance(mockedConverter),
            clientOptions: {},
            outputChannel: instance(
                mockObject<SwiftOutputChannel>({
                    dispose: mockFn(),
                })
            ),
            initializeResult: {
                capabilities: {
                    experimental: {
                        "window/didChangeActiveDocument": {
                            version: 1,
                        },
                    },
                },
            },
            start: mockFn(s =>
                s.callsFake(async () => {
                    const oldState = languageClientMock.state;
                    if (oldState !== State.Stopped) {
                        return;
                    }
                    languageClientMock.state = State.Starting;
                    await changeStateEmitter.fire({
                        oldState: oldState,
                        newState: State.Starting,
                    });
                    languageClientMock.state = State.Running;
                    await changeStateEmitter.fire({
                        oldState: State.Starting,
                        newState: State.Running,
                    });
                })
            ),
            stop: mockFn(s =>
                s.callsFake(async () => {
                    const oldState = languageClientMock.state;
                    languageClientMock.state = State.Stopped;
                    await changeStateEmitter.fire({
                        oldState,
                        newState: State.Stopped,
                    });
                })
            ),
            onRequest: mockFn(),
            sendNotification: mockFn(s => s.resolves()),
            onNotification: mockFn(s => s.returns(new vscode.Disposable(() => {}))),
            onDidChangeState: mockFn(s => s.callsFake(changeStateEmitter.event)),
        });
        // `new LanguageClient()` will always return the mocked LanguageClient
        languageClientFactoryMock = mockObject<LanguageClientFactory>({
            createLanguageClient: mockFn(s => s.returns(instance(languageClientMock))),
        });
        // LSP configuration defaults
        mockedConfig.path = "";
        mockedConfig.buildArguments = [];
        mockedConfig.backgroundIndexing = "off";
        mockedConfig.swiftEnvironmentVariables = {};
        mockedLspConfig.supportCFamily = "cpptools-inactive";
        mockedLspConfig.disable = false;
        mockedLspConfig.serverPath = "";
        mockedLspConfig.serverArguments = [];
        // Process environment variables
        mockedEnvironment.setValue({});
        // Exclusion
        excludeConfig.setValue({});
    });

    suite("LanguageClientToolchainCoordinator", () => {
        test("returns the same language client for the same folder", async () => {
            const factory = new LanguageClientToolchainCoordinator(
                instance(mockedWorkspace),
                {},
                languageClientFactoryMock
            );

            const sut1 = factory.get(instance(mockedFolder));
            const sut2 = factory.get(instance(mockedFolder));

            expect(sut1).to.equal(sut2, "Expected the same LanguageClient to be returned");
            expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnce;
        });

        test("returns the same language client for two folders with the same toolchain", async () => {
            const newFolder = mockObject<FolderContext>({
                isRootFolder: false,
                folder: vscode.Uri.file("/folder11"),
                workspaceFolder: {
                    uri: vscode.Uri.file("/folder11"),
                    name: "folder11",
                    index: 0,
                },
                workspaceContext: instance(mockedWorkspace),
                swiftVersion: mockedFolder.swiftVersion,
            });
            mockedWorkspace.folders.push(instance(newFolder));
            const factory = new LanguageClientToolchainCoordinator(
                instance(mockedWorkspace),
                {},
                languageClientFactoryMock
            );

            const sut1 = factory.get(instance(mockedFolder));
            const sut2 = factory.get(instance(newFolder));

            expect(sut1).to.equal(sut2, "Expected the same LanguageClient to be returned");
            expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnce;
        });

        test("returns the a new language client for folders with different toolchains", async () => {
            const newFolder = mockObject<FolderContext>({
                isRootFolder: false,
                folder: vscode.Uri.file("/folder11"),
                workspaceFolder: {
                    uri: vscode.Uri.file("/folder11"),
                    name: "folder11",
                    index: 0,
                },
                workspaceContext: instance(mockedWorkspace),
                swiftVersion: new Version(6, 1, 0),
            });
            mockedWorkspace.folders.push(instance(newFolder));
            const factory = new LanguageClientToolchainCoordinator(
                instance(mockedWorkspace),
                {},
                languageClientFactoryMock
            );

            const sut1 = factory.get(instance(mockedFolder));
            const sut2 = factory.get(instance(newFolder));

            expect(sut1).to.not.equal(sut2, "Expected different LanguageClients to be returned");
            expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnce;
        });
    });

    test("launches SourceKit-LSP on startup", async () => {
        const factory = new LanguageClientToolchainCoordinator(
            instance(mockedWorkspace),
            {},
            languageClientFactoryMock
        );

        const sut = factory.get(instance(mockedFolder));
        await waitForReturnedPromises(languageClientMock.start);

        expect(sut.state).to.equal(
            State.Running,
            "Expected LSP client to be running but it wasn't"
        );
        expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnceWith(
            /* id */ match.string,
            /* name */ match.string,
            /* serverOptions */ match.has("command", "/path/to/toolchain/bin/sourcekit-lsp"),
            /* clientOptions */ match.object
        );
        expect(languageClientMock.start).to.have.been.calledOnce;
    });

    test("launches SourceKit-LSP on startup with swiftSDK", async () => {
        mockedConfig.swiftSDK = "arm64-apple-ios";
        const factory = new LanguageClientToolchainCoordinator(
            instance(mockedWorkspace),
            {},
            languageClientFactoryMock
        );

        const sut = factory.get(instance(mockedFolder));
        await waitForReturnedPromises(languageClientMock.start);

        expect(sut.state).to.equal(
            State.Running,
            "Expected LSP client to be running but it wasn't"
        );
        expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnceWith(
            /* id */ match.string,
            /* name */ match.string,
            /* serverOptions */ match.has("command", "/path/to/toolchain/bin/sourcekit-lsp"),
            /* clientOptions */ match.hasNested(
                "initializationOptions.swiftPM.swiftSDK",
                "arm64-apple-ios"
            )
        );
        expect(languageClientMock.start).to.have.been.calledOnce;
    });

    test("chooses the correct backgroundIndexing value is auto, swift version if 6.0.0", async () => {
        mockedFolder.swiftVersion = new Version(6, 0, 0);
        mockedConfig.backgroundIndexing = "auto";

        new LanguageClientToolchainCoordinator(
            instance(mockedWorkspace),
            {},
            languageClientFactoryMock
        );
        await waitForReturnedPromises(languageClientMock.start);

        expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnceWith(
            match.string,
            match.string,
            match.object,
            match.hasNested("initializationOptions", doesNotHave("backgroundIndexing"))
        );
    });

    test("chooses the correct backgroundIndexing value is auto, swift version if 6.1.0", async () => {
        mockedFolder.swiftVersion = new Version(6, 1, 0);
        mockedConfig.backgroundIndexing = "auto";

        new LanguageClientToolchainCoordinator(
            instance(mockedWorkspace),
            {},
            languageClientFactoryMock
        );
        await waitForReturnedPromises(languageClientMock.start);

        expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnceWith(
            match.string,
            match.string,
            match.object,
            match.hasNested("initializationOptions.backgroundIndexing", match.truthy)
        );
    });

    test("chooses the correct backgroundIndexing value is true, swift version if 6.0.0", async () => {
        mockedFolder.swiftVersion = new Version(6, 0, 0);
        mockedConfig.backgroundIndexing = "on";

        new LanguageClientToolchainCoordinator(
            instance(mockedWorkspace),
            {},
            languageClientFactoryMock
        );
        await waitForReturnedPromises(languageClientMock.start);

        expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnceWith(
            match.string,
            match.string,
            match.object,
            match.hasNested("initializationOptions.backgroundIndexing", match.truthy)
        );
    });

    test("notifies SourceKit-LSP of WorkspaceFolder changes", async () => {
        const folder1 = mockObject<FolderContext>({
            isRootFolder: false,
            folder: vscode.Uri.file("/folder11"),
            workspaceFolder: {
                uri: vscode.Uri.file("/folder11"),
                name: "folder11",
                index: 0,
            },
            workspaceContext: instance(mockedWorkspace),
            swiftVersion: new Version(6, 0, 0),
        });
        const folder2 = mockObject<FolderContext>({
            isRootFolder: false,
            folder: vscode.Uri.file("/folder22"),
            workspaceFolder: {
                uri: vscode.Uri.file("/folder22"),
                name: "folder22",
                index: 1,
            },
            workspaceContext: instance(mockedWorkspace),
            swiftVersion: new Version(6, 0, 0),
        });

        new LanguageClientToolchainCoordinator(
            instance(mockedWorkspace),
            {},
            languageClientFactoryMock
        );
        await waitForReturnedPromises(languageClientMock.start);

        // Add the first folder
        mockedWorkspace.folders.push(instance(folder1));

        languageClientMock.sendNotification.resetHistory();
        await didChangeFoldersEmitter.fire({
            operation: FolderOperation.add,
            folder: instance(folder1),
            workspace: instance(mockedWorkspace),
        });

        expect(languageClientMock.sendNotification).to.have.been.calledWithExactly(
            DidChangeWorkspaceFoldersNotification.type,
            {
                event: {
                    added: [{ name: "folder11", uri: path.normalize("/folder11") }],
                    removed: [],
                },
            } as DidChangeWorkspaceFoldersParams
        );

        languageClientMock.sendNotification.resetHistory();

        // Add another folder
        mockedWorkspace.folders.push(instance(folder2));
        await didChangeFoldersEmitter.fire({
            operation: FolderOperation.add,
            folder: instance(folder2),
            workspace: instance(mockedWorkspace),
        });
        expect(languageClientMock.sendNotification).to.have.been.calledWithExactly(
            DidChangeWorkspaceFoldersNotification.type,
            {
                event: {
                    added: [{ name: "folder22", uri: path.normalize("/folder22") }],
                    removed: [],
                },
            } as DidChangeWorkspaceFoldersParams
        );

        languageClientMock.sendNotification.resetHistory();

        // Remove the first folder
        mockedWorkspace.folders.slice(1);
        await didChangeFoldersEmitter.fire({
            operation: FolderOperation.remove,
            folder: instance(folder1),
            workspace: instance(mockedWorkspace),
        });
        expect(languageClientMock.sendNotification).to.have.been.calledWithExactly(
            DidChangeWorkspaceFoldersNotification.type,
            {
                event: {
                    added: [],
                    removed: [{ name: "folder11", uri: path.normalize("/folder11") }],
                },
            } as DidChangeWorkspaceFoldersParams
        );
    });

    test("doesn't launch SourceKit-LSP if disabled by the user", async () => {
        mockedLspConfig.disable = true;
        const sut = new LanguageClientManager(
            instance(mockedFolder),
            {},
            languageClientFactoryMock
        );
        await waitForReturnedPromises(languageClientMock.start);

        expect(sut.state).to.equal(State.Stopped);
        expect(languageClientFactoryMock.createLanguageClient).to.not.have.been.called;
        expect(languageClientMock.start).to.not.have.been.called;
    });

    test("user can provide a custom SourceKit-LSP executable", async () => {
        mockedLspConfig.serverPath = "/path/to/my/custom/sourcekit-lsp";
        const factory = new LanguageClientToolchainCoordinator(
            instance(mockedWorkspace),
            {},
            languageClientFactoryMock
        );

        const sut = factory.get(instance(mockedFolder));
        await waitForReturnedPromises(languageClientMock.start);

        expect(sut.state).to.equal(
            State.Running,
            "Expected LSP client to be running but it wasn't"
        );
        expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnceWith(
            /* id */ match.string,
            /* name */ match.string,
            /* serverOptions */ match.has("command", "/path/to/my/custom/sourcekit-lsp"),
            /* clientOptions */ match.object
        );
        expect(languageClientMock.start).to.have.been.calledOnce;
    });

    test("adds VS Code iconography to CodeLenses", async () => {
        const codelensesFromSourceKitLSP = async (): Promise<vscode.CodeLens[]> => {
            return [
                {
                    range: new vscode.Range(0, 0, 0, 0),
                    command: {
                        title: "Run",
                        command: "swift.run",
                    },
                    isResolved: true,
                },
                {
                    range: new vscode.Range(0, 0, 0, 0),
                    command: {
                        title: "Debug",
                        command: "swift.debug",
                    },
                    isResolved: true,
                },
                {
                    range: new vscode.Range(0, 0, 0, 0),
                    command: {
                        title: "Run",
                        command: "some.other.command",
                    },
                    isResolved: true,
                },
            ];
        };

        new LanguageClientToolchainCoordinator(
            instance(mockedWorkspace),
            {},
            languageClientFactoryMock
        );

        await waitForReturnedPromises(languageClientMock.start);

        expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnce;
        const middleware = languageClientFactoryMock.createLanguageClient.args[0][3].middleware!;
        expect(middleware).to.have.property("provideCodeLenses");
        await expect(
            middleware.provideCodeLenses!({} as any, {} as any, codelensesFromSourceKitLSP)
        ).to.eventually.deep.equal([
            {
                range: new vscode.Range(0, 0, 0, 0),
                command: {
                    title: "$(play)\u00A0Run",
                    command: "swift.run",
                },
                isResolved: true,
            },
            {
                range: new vscode.Range(0, 0, 0, 0),
                command: {
                    title: "$(debug)\u00A0Debug",
                    command: "swift.debug",
                },
                isResolved: true,
            },
            {
                range: new vscode.Range(0, 0, 0, 0),
                command: {
                    title: "Run",
                    command: "some.other.command",
                },
                isResolved: true,
            },
        ]);
    });

    suite("provideCompletionItem middleware", () => {
        const mockParameterHintsEnabled = mockGlobalValue(configuration, "parameterHintsEnabled");
        let document: MockedObject<vscode.TextDocument>;
        let middleware: Middleware;

        setup(async () => {
            mockParameterHintsEnabled.setValue(() => true);

            document = mockObject<vscode.TextDocument>({
                uri: vscode.Uri.file("/test/file.swift"),
            });

            new LanguageClientToolchainCoordinator(
                instance(mockedWorkspace),
                {},
                languageClientFactoryMock
            );

            await waitForReturnedPromises(languageClientMock.start);

            middleware = languageClientFactoryMock.createLanguageClient.args[0][3].middleware!;
        });

        test("adds parameter hints command to function completion items when enabled", async () => {
            const completionItemsFromLSP = async (): Promise<vscode.CompletionItem[]> => {
                return [
                    {
                        label: "post(endpoint: String, body: [String : Any]?)",
                        detail: "NetworkRequest",
                        kind: vscode.CompletionItemKind.EnumMember,
                    },
                    {
                        label: "defaultHeaders",
                        detail: "[String : String]",
                        kind: vscode.CompletionItemKind.Property,
                    },
                    {
                        label: "makeRequest(for: NetworkRequest)",
                        detail: "String",
                        kind: vscode.CompletionItemKind.Function,
                    },
                    {
                        label: "[endpoint: String]",
                        detail: "NetworkRequest",
                        kind: vscode.CompletionItemKind.Method,
                    },
                    {
                        label: "(endpoint: String, method: String)",
                        detail: "NetworkRequest",
                        kind: vscode.CompletionItemKind.Constructor,
                    },
                ];
            };

            expect(middleware).to.have.property("provideCompletionItem");

            const result = await middleware.provideCompletionItem!(
                instance(document),
                new vscode.Position(0, 0),
                {} as any,
                {} as any,
                completionItemsFromLSP
            );

            expect(result).to.deep.equal([
                {
                    label: "post(endpoint: String, body: [String : Any]?)",
                    detail: "NetworkRequest",
                    kind: vscode.CompletionItemKind.EnumMember,
                    command: {
                        title: "Trigger Parameter Hints",
                        command: "editor.action.triggerParameterHints",
                    },
                },
                {
                    label: "defaultHeaders",
                    detail: "[String : String]",
                    kind: vscode.CompletionItemKind.Property,
                },
                {
                    label: "makeRequest(for: NetworkRequest)",
                    detail: "String",
                    kind: vscode.CompletionItemKind.Function,
                    command: {
                        title: "Trigger Parameter Hints",
                        command: "editor.action.triggerParameterHints",
                    },
                },
                {
                    label: "[endpoint: String]",
                    detail: "NetworkRequest",
                    kind: vscode.CompletionItemKind.Method,
                    command: {
                        title: "Trigger Parameter Hints",
                        command: "editor.action.triggerParameterHints",
                    },
                },
                {
                    label: "(endpoint: String, method: String)",
                    detail: "NetworkRequest",
                    kind: vscode.CompletionItemKind.Constructor,
                    command: {
                        title: "Trigger Parameter Hints",
                        command: "editor.action.triggerParameterHints",
                    },
                },
            ]);
        });

        test("does not add parameter hints command when disabled", async () => {
            mockParameterHintsEnabled.setValue(() => false);

            const completionItems = [
                {
                    label: "makeRequest(for: NetworkRequest)",
                    detail: "String",
                    kind: vscode.CompletionItemKind.Function,
                },
                {
                    label: "[endpoint: String]",
                    detail: "NetworkRequest",
                    kind: vscode.CompletionItemKind.Method,
                },
            ];

            const completionItemsFromLSP = async (): Promise<vscode.CompletionItem[]> => {
                return completionItems;
            };

            const result = await middleware.provideCompletionItem!(
                instance(document),
                new vscode.Position(0, 0),
                {} as any,
                {} as any,
                completionItemsFromLSP
            );

            expect(result).to.deep.equal(completionItems);
        });

        test("handles CompletionList result format", async () => {
            const completionListFromLSP = async (): Promise<vscode.CompletionList> => {
                return {
                    isIncomplete: false,
                    items: [
                        {
                            label: "defaultHeaders",
                            detail: "[String : String]",
                            kind: vscode.CompletionItemKind.Property,
                        },
                        {
                            label: "makeRequest(for: NetworkRequest)",
                            detail: "String",
                            kind: vscode.CompletionItemKind.Function,
                        },
                    ],
                };
            };

            const result = await middleware.provideCompletionItem!(
                instance(document),
                new vscode.Position(0, 0),
                {} as any,
                {} as any,
                completionListFromLSP
            );

            expect(result).to.deep.equal({
                isIncomplete: false,
                items: [
                    {
                        label: "defaultHeaders",
                        detail: "[String : String]",
                        kind: vscode.CompletionItemKind.Property,
                    },
                    {
                        label: "makeRequest(for: NetworkRequest)",
                        detail: "String",
                        kind: vscode.CompletionItemKind.Function,
                        command: {
                            title: "Trigger Parameter Hints",
                            command: "editor.action.triggerParameterHints",
                        },
                    },
                ],
            });
        });

        test("handles null/undefined result from next middleware", async () => {
            mockParameterHintsEnabled.setValue(() => true);

            const nullCompletionResult = async (): Promise<null> => {
                return null;
            };

            const result = await middleware.provideCompletionItem!(
                instance(document),
                new vscode.Position(0, 0),
                {} as any,
                {} as any,
                nullCompletionResult
            );

            expect(result).to.be.null;
        });
    });

    suite("active document changes", () => {
        const mockWindow = mockGlobalObject(vscode, "window");

        setup(() => {
            mockedWorkspace.globalToolchainSwiftVersion = new Version(6, 1, 0);
        });

        test("Notifies when the active document changes", async () => {
            const document: vscode.TextDocument = instance(
                mockObject<vscode.TextDocument>({
                    uri: vscode.Uri.file("/folder1/file.swift"),
                })
            );

            let _listener: ((e: vscode.TextEditor | undefined) => any) | undefined;
            mockWindow.onDidChangeActiveTextEditor.callsFake((listener, _2, _1) => {
                _listener = listener;
                return { dispose: () => {} };
            });

            new LanguageClientManager(instance(mockedFolder), {}, languageClientFactoryMock);
            await waitForReturnedPromises(languageClientMock.start);

            const activeDocumentManager = new LSPActiveDocumentManager();
            activeDocumentManager.activateDidChangeActiveDocument(instance(languageClientMock));
            await activeDocumentManager.didOpen(document, async () => {});

            if (_listener) {
                _listener(instance(mockObject<vscode.TextEditor>({ document })));
            }

            expect(languageClientMock.sendNotification).to.have.been.calledOnceWith(
                DidChangeActiveDocumentNotification.method,
                {
                    textDocument: {
                        uri: path.normalize("/folder1/file.swift"),
                    },
                } as DidChangeActiveDocumentParams
            );
        });

        test("Notifies on startup with the active document", async () => {
            const document: vscode.TextDocument = instance(
                mockObject<vscode.TextDocument>({
                    uri: vscode.Uri.file("/folder1/file.swift"),
                })
            );
            mockWindow.activeTextEditor = instance(
                mockObject<vscode.TextEditor>({
                    document,
                })
            );
            new LanguageClientManager(instance(mockedFolder), {}, languageClientFactoryMock);
            await waitForReturnedPromises(languageClientMock.start);

            const activeDocumentManager = new LSPActiveDocumentManager();
            await activeDocumentManager.didOpen(document, async () => {});

            activeDocumentManager.activateDidChangeActiveDocument(instance(languageClientMock));

            expect(languageClientMock.sendNotification).to.have.been.calledOnceWith(
                DidChangeActiveDocumentNotification.method,
                {
                    textDocument: {
                        uri: path.normalize("/folder1/file.swift"),
                    },
                } as DidChangeActiveDocumentParams
            );
        });
    });

    suite("SourceKit-LSP version doesn't support workspace folders", () => {
        let folder1: MockedObject<FolderContext>;
        let folder2: MockedObject<FolderContext>;

        setup(() => {
            mockedToolchain.swiftVersion = new Version(5, 6, 0);
            mockedWorkspace.globalToolchainSwiftVersion = new Version(5, 6, 0);
            const workspaceFolder = {
                uri: vscode.Uri.file("/folder1"),
                name: "folder1",
                index: 0,
            };
            const folderContext = mockObject<FolderContext>({
                workspaceContext: instance(mockedWorkspace),
                workspaceFolder,
                toolchain: instance(mockedToolchain),
            });
            mockedFolder.swiftVersion = mockedToolchain.swiftVersion;
            mockedWorkspace = mockObject<WorkspaceContext>({
                ...mockedWorkspace,
                globalToolchain: instance(mockedToolchain),
                currentFolder: instance(folderContext),
                get globalToolchainSwiftVersion() {
                    return mockedToolchain.swiftVersion;
                },
                folders: [instance(mockedFolder)],
            });
            folder1 = mockObject<FolderContext>({
                isRootFolder: false,
                folder: vscode.Uri.file("/folder1"),
                workspaceFolder,
                workspaceContext: instance(mockedWorkspace),
                toolchain: instance(mockedToolchain),
                swiftVersion: mockedToolchain.swiftVersion,
            });
            folder2 = mockObject<FolderContext>({
                isRootFolder: false,
                folder: vscode.Uri.file("/folder2"),
                workspaceFolder: {
                    uri: vscode.Uri.file("/folder2"),
                    name: "folder2",
                    index: 1,
                },
                workspaceContext: instance(mockedWorkspace),
                toolchain: instance(mockedToolchain),
                swiftVersion: mockedToolchain.swiftVersion,
            });
        });

        test("doesn't launch SourceKit-LSP on startup", async () => {
            const sut = new LanguageClientManager(
                instance(mockedFolder),
                {},
                languageClientFactoryMock
            );
            await waitForReturnedPromises(languageClientMock.start);

            expect(sut.state).to.equal(State.Stopped);
            expect(languageClientFactoryMock.createLanguageClient).to.not.have.been.called;
            expect(languageClientMock.start).to.not.have.been.called;
        });

        test("launches SourceKit-LSP when a Swift file is opened", async () => {
            mockedVSCodeWindow.activeTextEditor = instance(
                mockObject<vscode.TextEditor>({
                    document: instance(
                        mockObject<vscode.TextDocument>({
                            uri: vscode.Uri.file("/folder1/file.swift"),
                        })
                    ),
                })
            );
            const factory = new LanguageClientToolchainCoordinator(
                instance(mockedWorkspace),
                {},
                languageClientFactoryMock
            );

            const sut = factory.get(instance(mockedFolder));
            await waitForReturnedPromises(languageClientMock.start);

            // Add the folder to the workspace
            await didChangeFoldersEmitter.fire({
                operation: FolderOperation.add,
                folder: instance(folder1),
                workspace: instance(mockedWorkspace),
            });

            expect(sut.state).to.equal(
                State.Running,
                "Expected LSP client to be running but it wasn't"
            );
            expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledWith(
                /* id */ match.string,
                /* name */ match.string,
                /* serverOptions */ match.object,
                /* clientOptions */ match.hasNested("workspaceFolder.uri.path", "/folder1")
            );
            expect(languageClientMock.start).to.have.been.called;
        });

        test("changes SourceKit-LSP's workspaceFolder when a new folder is focussed", async () => {
            const mockedTextDocument = mockObject<vscode.TextDocument>({
                uri: vscode.Uri.file("/folder1/file.swift"),
            });
            mockedVSCodeWindow.activeTextEditor = instance(
                mockObject<vscode.TextEditor>({
                    document: instance(mockedTextDocument),
                })
            );
            const factory = new LanguageClientToolchainCoordinator(
                instance(mockedWorkspace),
                {},
                languageClientFactoryMock
            );

            const sut = factory.get(instance(mockedFolder));
            await waitForReturnedPromises(languageClientMock.start);

            // Trigger a focus event for the second folder
            mockedTextDocument.uri = vscode.Uri.file("/folder2/file.swift");
            await didChangeFoldersEmitter.fire({
                operation: FolderOperation.focus,
                folder: instance(folder2),
                workspace: instance(mockedWorkspace),
            });

            expect(sut.state).to.equal(
                State.Running,
                "Expected LSP client to be running but it wasn't"
            );
            expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledTwice;
            expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledWith(
                /* id */ match.string,
                /* name */ match.string,
                /* serverOptions */ match.object,
                /* clientOptions */ match.hasNested("workspaceFolder.uri.path", "/folder2")
            );
            expect(languageClientMock.start).to.have.been.calledTwice;
            expect(languageClientMock.start).to.have.been.calledAfter(languageClientMock.stop);
        });
    });
});
