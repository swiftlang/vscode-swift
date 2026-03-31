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

import { DiagnosticsManager } from "@src/DiagnosticsManager";
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
    let coordinator: LanguageClientToolchainCoordinator | undefined;

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
        mockedVSCodeWorkspace.registerTextDocumentContentProvider.returns(
            new vscode.Disposable(() => {})
        );
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
                    diagnostics: instance(
                        mockObject<DiagnosticsManager>({
                            handleDiagnostics: mockFn(),
                        })
                    ),
                })
            ),
            swiftVersion: new Version(6, 0, 0),
            toolchain: instance(mockedToolchain),
            logger: instance(mockLogger),
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
                    warn: mockFn(),
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
            onNotification: mockFn(s => s.returns({ dispose() {} })),
            onDidChangeState: mockFn(s => s.callsFake(changeStateEmitter.event)),
            dispose: mockFn(s => s.resolves()),
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

    teardown(() => {
        coordinator?.dispose();
    });

    suite("LanguageClientToolchainCoordinator", () => {
        test("returns the same language client for the same folder", async () => {
            const factory = new LanguageClientToolchainCoordinator(
                instance(mockedWorkspace),
                {},
                languageClientFactoryMock
            );
            await factory.initialized;

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
                toolchain: instance(mockedToolchain),
                logger: instance(mockLogger),
            });
            mockedWorkspace.folders.push(instance(newFolder));
            const factory = new LanguageClientToolchainCoordinator(
                instance(mockedWorkspace),
                {},
                languageClientFactoryMock
            );
            await factory.initialized;

            const sut1 = factory.get(instance(mockedFolder));
            const sut2 = factory.get(instance(newFolder));

            expect(sut1).to.equal(sut2, "Expected the same LanguageClient to be returned");
            expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnce;
        });

        test("returns the a new language client for folders with different toolchains", async () => {
            const differentToolchain = mockObject<SwiftToolchain>({
                swiftVersion: new Version(6, 1, 0),
                buildFlags: mockedBuildFlags as unknown as BuildFlags,
                getToolchainExecutable: mockFn(s =>
                    s.withArgs("sourcekit-lsp").returns("/path/to/toolchain/bin/sourcekit-lsp")
                ),
            });

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
                toolchain: instance(differentToolchain),
                logger: instance(mockLogger),
            });
            mockedWorkspace.folders.push(instance(newFolder));
            const factory = new LanguageClientToolchainCoordinator(
                instance(mockedWorkspace),
                {},
                languageClientFactoryMock
            );
            await factory.initialized;

            factory.get(instance(mockedFolder));
            factory.get(instance(newFolder));
            expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledTwice;
        });
    });

    test("chooses the correct backgroundIndexing value is auto, swift version if 6.0.0", async () => {
        mockedFolder.swiftVersion = new Version(6, 0, 0);
        mockedConfig.backgroundIndexing = "auto";

        coordinator = new LanguageClientToolchainCoordinator(
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

        coordinator = new LanguageClientToolchainCoordinator(
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

        coordinator = new LanguageClientToolchainCoordinator(
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
            toolchain: instance(mockedToolchain),
            logger: instance(mockLogger),
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
            toolchain: instance(mockedToolchain),
            logger: instance(mockLogger),
        });

        coordinator = new LanguageClientToolchainCoordinator(
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
        mockedWorkspace.folders = mockedWorkspace.folders.slice(1);
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

    test("addFolder does not duplicate notification for pre-registered folder", async () => {
        coordinator = new LanguageClientToolchainCoordinator(
            instance(mockedWorkspace),
            {},
            languageClientFactoryMock
        );
        await coordinator.initialized;
        await waitForReturnedPromises(languageClientMock.start);

        const folder1Notifications = languageClientMock.sendNotification
            .getCalls()
            .filter(
                call =>
                    call.args[1]?.event?.added?.some(
                        (f: { uri: string }) => f.uri === path.normalize("/folder1")
                    ) === true
            );
        expect(folder1Notifications).to.have.lengthOf(1);
    });

    test("doesn't launch SourceKit-LSP if disabled by the user", async () => {
        mockedLspConfig.disable = true;
        const sut = await LanguageClientManager.create(
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
        await factory.initialized;

        const sut = factory.get(instance(mockedFolder));

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
                        title: 'Play "bar"',
                        command: "swift.play",
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

        coordinator = new LanguageClientToolchainCoordinator(
            instance(mockedWorkspace),
            {},
            languageClientFactoryMock
        );

        await waitForReturnedPromises(languageClientMock.start);

        expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnce;
        const middleware = languageClientFactoryMock.createLanguageClient.args[0][3].middleware!;
        expect(middleware).to.have.property("provideCodeLenses");
        await expect(
            middleware.provideCodeLenses!(
                { uri: vscode.Uri.file("/folder1/doc.swift") } as any,
                {} as any,
                codelensesFromSourceKitLSP
            )
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
                    title: '$(play)\u00A0Play "bar"',
                    command: "swift.play",
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
                uri: vscode.Uri.file("/folder1/file.swift"),
            });

            coordinator = new LanguageClientToolchainCoordinator(
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
        let clientManager: LanguageClientManager | undefined;

        setup(() => {
            mockedWorkspace.globalToolchainSwiftVersion = new Version(6, 1, 0);
            mockWindow.onDidChangeActiveTextEditor.returns(new vscode.Disposable(() => {}));
        });

        teardown(async () => {
            await clientManager?.stop();
            clientManager?.dispose();
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

            clientManager = await LanguageClientManager.create(
                instance(mockedFolder),
                {},
                languageClientFactoryMock
            );
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
            clientManager = await LanguageClientManager.create(
                instance(mockedFolder),
                {},
                languageClientFactoryMock
            );
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

    suite("WorkspaceFolderGate integration", () => {
        test("addFolder signals the gate after sending didChangeWorkspaceFolders", async () => {
            const sut = await LanguageClientManager.create(
                instance(mockedFolder),
                {},
                languageClientFactoryMock
            );
            await waitForReturnedPromises(languageClientMock.start);

            const docUri = vscode.Uri.file("/folder22/Sources/main.swift");
            let resolved = false;
            const waitPromise = sut.folderGate.waitForFolder(docUri, 2000).then(() => {
                resolved = true;
            });

            await new Promise(r => setTimeout(r, 50));
            expect(resolved).to.be.false;

            const newFolder = mockObject<FolderContext>({
                isRootFolder: false,
                folder: vscode.Uri.file("/folder22"),
                workspaceFolder: {
                    uri: vscode.Uri.file("/folder22"),
                    name: "folder22",
                    index: 1,
                },
                workspaceContext: instance(mockedWorkspace),
                swiftVersion: new Version(6, 0, 0),
                toolchain: instance(mockedToolchain),
                logger: instance(mockLogger),
            });

            await sut.addFolder(instance(newFolder));
            await waitPromise;

            expect(resolved).to.be.true;
        });

        test("removeFolder removes the folder from the gate", async () => {
            const sut = await LanguageClientManager.create(
                instance(mockedFolder),
                {},
                languageClientFactoryMock
            );
            await waitForReturnedPromises(languageClientMock.start);

            const newFolder = mockObject<FolderContext>({
                isRootFolder: false,
                folder: vscode.Uri.file("/folder22"),
                workspaceFolder: {
                    uri: vscode.Uri.file("/folder22"),
                    name: "folder22",
                    index: 1,
                },
                workspaceContext: instance(mockedWorkspace),
                swiftVersion: new Version(6, 0, 0),
                toolchain: instance(mockedToolchain),
                logger: instance(mockLogger),
            });

            await sut.addFolder(instance(newFolder));

            const docUri = vscode.Uri.file("/folder22/Sources/main.swift");
            let resolvedImmediately = false;
            await sut.folderGate.waitForFolder(docUri, 100).then(() => {
                resolvedImmediately = true;
            });
            expect(resolvedImmediately).to.be.true;

            await sut.removeFolder(instance(newFolder));

            let resolvedAfterRemoval = false;
            const waitPromise = sut.folderGate.waitForFolder(docUri, 200).then(() => {
                resolvedAfterRemoval = true;
            });

            await new Promise(r => setTimeout(r, 50));
            expect(resolvedAfterRemoval).to.be.false;

            await waitPromise;
        });
    });

    suite("middleware folder gating", () => {
        let middleware: Middleware;

        setup(async () => {
            coordinator = new LanguageClientToolchainCoordinator(
                instance(mockedWorkspace),
                {},
                languageClientFactoryMock
            );
            await waitForReturnedPromises(languageClientMock.start);
            middleware = languageClientFactoryMock.createLanguageClient.args[0][3].middleware!;
        });

        test("didOpen is deferred for documents in unregistered folders", async () => {
            const document = instance(
                mockObject<vscode.TextDocument>({
                    uri: vscode.Uri.file("/unregistered/Sources/lib.swift"),
                })
            );
            let nextCalled = false;
            const next = async () => {
                nextCalled = true;
            };

            const openPromise = middleware.didOpen!(document, next);
            await new Promise(r => setTimeout(r, 50));
            expect(nextCalled).to.be.false;

            const newFolder = mockObject<FolderContext>({
                isRootFolder: false,
                folder: vscode.Uri.file("/unregistered"),
                workspaceFolder: {
                    uri: vscode.Uri.file("/unregistered"),
                    name: "unregistered",
                    index: 1,
                },
                workspaceContext: instance(mockedWorkspace),
                swiftVersion: new Version(6, 0, 0),
                toolchain: instance(mockedToolchain),
                logger: instance(mockLogger),
            });
            mockedWorkspace.folders.push(instance(newFolder));
            await didChangeFoldersEmitter.fire({
                operation: FolderOperation.add,
                folder: instance(newFolder),
                workspace: instance(mockedWorkspace),
            });

            await openPromise;
            expect(nextCalled).to.be.true;
        });

        test("didOpen passes through immediately for documents in known folders", async () => {
            const document = instance(
                mockObject<vscode.TextDocument>({
                    uri: vscode.Uri.file("/folder1/Sources/lib.swift"),
                })
            );
            let nextCalled = false;
            const next = async () => {
                nextCalled = true;
            };

            await middleware.didOpen!(document, next);
            expect(nextCalled).to.be.true;
        });

        test("provideDiagnostics is deferred for documents in unregistered folders", async () => {
            const document = instance(
                mockObject<vscode.TextDocument>({
                    uri: vscode.Uri.file("/unregistered/Sources/lib.swift"),
                })
            );
            let nextCalled = false;
            const next = async () => {
                nextCalled = true;
                return undefined;
            };

            const diagnosticsPromise = middleware.provideDiagnostics!(
                document as any,
                "prev",
                new vscode.CancellationTokenSource().token,
                next
            );
            await new Promise(r => setTimeout(r, 50));
            expect(nextCalled).to.be.false;

            const newFolder = mockObject<FolderContext>({
                isRootFolder: false,
                folder: vscode.Uri.file("/unregistered"),
                workspaceFolder: {
                    uri: vscode.Uri.file("/unregistered"),
                    name: "unregistered",
                    index: 1,
                },
                workspaceContext: instance(mockedWorkspace),
                swiftVersion: new Version(6, 0, 0),
                toolchain: instance(mockedToolchain),
                logger: instance(mockLogger),
            });
            mockedWorkspace.folders.push(instance(newFolder));
            await didChangeFoldersEmitter.fire({
                operation: FolderOperation.add,
                folder: instance(newFolder),
                workspace: instance(mockedWorkspace),
            });

            await diagnosticsPromise;
            expect(nextCalled).to.be.true;
        });
    });

    test("disposes old output channel before creating new client on restart", async () => {
        const callOrder: string[] = [];

        const firstOutputChannel = mockObject<SwiftOutputChannel>({
            dispose: mockFn(s =>
                s.callsFake(() => {
                    callOrder.push("dispose-old-output-channel");
                })
            ),
            warn: mockFn(),
        });

        languageClientMock.outputChannel = instance(firstOutputChannel);

        coordinator = new LanguageClientToolchainCoordinator(
            instance(mockedWorkspace),
            {},
            languageClientFactoryMock
        );
        await coordinator.initialized;
        const sut = coordinator.get(instance(mockedFolder));

        expect(sut.state).to.equal(State.Running);

        const secondOutputChannel = mockObject<SwiftOutputChannel>({
            dispose: mockFn(),
            warn: mockFn(),
        });

        languageClientFactoryMock.createLanguageClient.callsFake(() => {
            callOrder.push("create-new-client");
            languageClientMock.outputChannel = instance(secondOutputChannel);
            return instance(languageClientMock);
        });

        await sut.restart();
        await waitForReturnedPromises(languageClientMock.start);

        expect(callOrder).to.deep.equal(["dispose-old-output-channel", "create-new-client"]);
    });
});
