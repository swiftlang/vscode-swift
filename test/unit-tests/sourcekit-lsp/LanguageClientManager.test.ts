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

import * as vscode from "vscode";
import { expect } from "chai";
import { match } from "sinon";
import { FolderEvent, FolderOperation, WorkspaceContext } from "../../../src/WorkspaceContext";
import { Version } from "../../../src/utilities/version";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { BuildFlags } from "../../../src/toolchain/BuildFlags";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";
import {
    MockedObject,
    mockObject,
    instance,
    mockGlobalModule,
    waitForReturnedPromises,
    AsyncEventEmitter,
    mockGlobalObject,
    mockGlobalValue,
    mockFn,
} from "../../MockUtils";
import {
    Code2ProtocolConverter,
    DidChangeWorkspaceFoldersNotification,
    DidChangeWorkspaceFoldersParams,
    LanguageClient,
    State,
    StateChangeEvent,
} from "vscode-languageclient/node";
import { LanguageClientManager } from "../../../src/sourcekit-lsp/LanguageClientManager";
import configuration from "../../../src/configuration";
import { FolderContext } from "../../../src/FolderContext";
import { LanguageClientFactory } from "../../../src/sourcekit-lsp/LanguageClientFactory";

suite("LanguageClientManager Suite", () => {
    let languageClientFactoryMock: MockedObject<LanguageClientFactory>;
    let languageClientMock: MockedObject<LanguageClient>;
    let mockedConverter: MockedObject<Code2ProtocolConverter>;
    let changeStateEmitter: AsyncEventEmitter<StateChangeEvent>;
    let mockedWorkspace: MockedObject<WorkspaceContext>;
    let didChangeFoldersEmitter: AsyncEventEmitter<FolderEvent>;
    let mockedOutputChannel: MockedObject<SwiftOutputChannel>;
    let mockedToolchain: MockedObject<SwiftToolchain>;
    let mockedBuildFlags: MockedObject<BuildFlags>;

    const mockedConfig = mockGlobalModule(configuration);
    const mockedEnvironment = mockGlobalValue(process, "env");
    const mockedLspConfig = mockGlobalObject(configuration, "lsp");
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");
    const mockedVSCodeExtensions = mockGlobalObject(vscode, "extensions");
    const mockedVSCodeWorkspace = mockGlobalObject(vscode, "workspace");
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
        // Mock the WorkspaceContext and SwiftToolchain
        mockedBuildFlags = mockObject<BuildFlags>({
            buildPathFlags: mockFn(s => s.returns([])),
            swiftDriverSDKFlags: mockFn(s => s.returns([])),
            swiftDriverTargetFlags: mockFn(s => s.returns([])),
        });
        mockedToolchain = mockObject<SwiftToolchain>({
            swiftVersion: new Version(6, 0, 0),
            buildFlags: mockedBuildFlags,
            getToolchainExecutable: mockFn(s =>
                s.withArgs("sourcekit-lsp").returns("/path/to/toolchain/bin/sourcekit-lsp")
            ),
        });
        mockedOutputChannel = mockObject<SwiftOutputChannel>({
            log: s => s,
            logDiagnostic: s => s,
        });
        didChangeFoldersEmitter = new AsyncEventEmitter();
        mockedWorkspace = mockObject<WorkspaceContext>({
            toolchain: instance(mockedToolchain),
            swiftVersion: new Version(6, 0, 0),
            outputChannel: instance(mockedOutputChannel),
            subscriptions: [],
            folders: [],
            onDidChangeFolders: mockFn(s => s.callsFake(didChangeFoldersEmitter.event)),
        });
        mockedConverter = mockObject<Code2ProtocolConverter>({
            asUri: mockFn(s => s.callsFake(uri => uri.fsPath)),
        });
        changeStateEmitter = new AsyncEventEmitter();
        languageClientMock = mockObject<LanguageClient>({
            state: State.Stopped,
            code2ProtocolConverter: instance(mockedConverter),
            clientOptions: {},
            outputChannel: instance(
                mockObject<vscode.OutputChannel>({
                    dispose: mockFn(),
                })
            ),
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
    });

    test("launches SourceKit-LSP on startup", async () => {
        const sut = new LanguageClientManager(instance(mockedWorkspace), languageClientFactoryMock);
        await waitForReturnedPromises(languageClientMock.start);

        expect(sut.state).to.equal(State.Running);
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

        const sut = new LanguageClientManager(instance(mockedWorkspace), languageClientFactoryMock);
        await waitForReturnedPromises(languageClientMock.start);

        expect(sut.state).to.equal(State.Running);
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
        mockedWorkspace.swiftVersion = new Version(6, 0, 0);
        mockedConfig.backgroundIndexing = "auto";

        new LanguageClientManager(instance(mockedWorkspace), languageClientFactoryMock);
        await waitForReturnedPromises(languageClientMock.start);

        expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnceWith(
            match.string,
            match.string,
            match.object,
            match.hasNested("initializationOptions", doesNotHave("backgroundIndexing"))
        );
    });

    test("chooses the correct backgroundIndexing value is auto, swift version if 6.1.0", async () => {
        mockedWorkspace.swiftVersion = new Version(6, 1, 0);
        mockedConfig.backgroundIndexing = "auto";

        new LanguageClientManager(instance(mockedWorkspace), languageClientFactoryMock);
        await waitForReturnedPromises(languageClientMock.start);

        expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnceWith(
            match.string,
            match.string,
            match.object,
            match.hasNested("initializationOptions.backgroundIndexing", match.truthy)
        );
    });

    test("chooses the correct backgroundIndexing value is true, swift version if 6.0.0", async () => {
        mockedWorkspace.swiftVersion = new Version(6, 0, 0);
        mockedConfig.backgroundIndexing = "on";

        new LanguageClientManager(instance(mockedWorkspace), languageClientFactoryMock);
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
            folder: vscode.Uri.file("/folder1"),
            workspaceFolder: {
                uri: vscode.Uri.file("/folder1"),
                name: "folder1",
                index: 0,
            },
            workspaceContext: instance(mockedWorkspace),
        });
        const folder2 = mockObject<FolderContext>({
            isRootFolder: false,
            folder: vscode.Uri.file("/folder2"),
            workspaceFolder: {
                uri: vscode.Uri.file("/folder2"),
                name: "folder2",
                index: 1,
            },
            workspaceContext: instance(mockedWorkspace),
        });
        new LanguageClientManager(instance(mockedWorkspace), languageClientFactoryMock);
        await waitForReturnedPromises(languageClientMock.start);

        // Add the first folder
        mockedWorkspace.folders.push(instance(folder1));
        await didChangeFoldersEmitter.fire({
            operation: FolderOperation.add,
            folder: instance(folder1),
            workspace: instance(mockedWorkspace),
        });
        expect(languageClientMock.sendNotification).to.have.been.calledOnceWith(
            DidChangeWorkspaceFoldersNotification.type,
            {
                event: {
                    added: [{ name: "folder1", uri: "/folder1" }],
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
        expect(languageClientMock.sendNotification).to.have.been.calledOnceWith(
            DidChangeWorkspaceFoldersNotification.type,
            {
                event: {
                    added: [{ name: "folder2", uri: "/folder2" }],
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
        expect(languageClientMock.sendNotification).to.have.been.calledWith(
            DidChangeWorkspaceFoldersNotification.type,
            {
                event: {
                    added: [],
                    removed: [{ name: "folder1", uri: "/folder1" }],
                },
            } as DidChangeWorkspaceFoldersParams
        );
    });

    test("doesn't launch SourceKit-LSP if disabled by the user", async () => {
        mockedLspConfig.disable = true;
        const sut = new LanguageClientManager(instance(mockedWorkspace), languageClientFactoryMock);
        await waitForReturnedPromises(languageClientMock.start);

        expect(sut.state).to.equal(State.Stopped);
        expect(languageClientFactoryMock.createLanguageClient).to.not.have.been.called;
        expect(languageClientMock.start).to.not.have.been.called;
    });

    test("user can provide a custom SourceKit-LSP executable", async () => {
        mockedLspConfig.serverPath = "/path/to/my/custom/sourcekit-lsp";
        const sut = new LanguageClientManager(instance(mockedWorkspace), languageClientFactoryMock);
        await waitForReturnedPromises(languageClientMock.start);

        expect(sut.state).to.equal(State.Running);
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

        new LanguageClientManager(instance(mockedWorkspace), languageClientFactoryMock);
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
                    title: "$(play) Run",
                    command: "swift.run",
                },
                isResolved: true,
            },
            {
                range: new vscode.Range(0, 0, 0, 0),
                command: {
                    title: "$(debug) Debug",
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

    suite("SourceKit-LSP version doesn't support workspace folders", () => {
        let folder1: MockedObject<FolderContext>;
        let folder2: MockedObject<FolderContext>;

        setup(() => {
            mockedToolchain.swiftVersion = new Version(5, 6, 0);
            mockedWorkspace.swiftVersion = new Version(5, 6, 0);
            folder1 = mockObject<FolderContext>({
                isRootFolder: false,
                folder: vscode.Uri.file("/folder1"),
                workspaceFolder: {
                    uri: vscode.Uri.file("/folder1"),
                    name: "folder1",
                    index: 0,
                },
                workspaceContext: instance(mockedWorkspace),
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
            });
        });

        test("doesn't launch SourceKit-LSP on startup", async () => {
            const sut = new LanguageClientManager(
                instance(mockedWorkspace),
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
            const sut = new LanguageClientManager(
                instance(mockedWorkspace),
                languageClientFactoryMock
            );
            await waitForReturnedPromises(languageClientMock.start);

            // Add the folder to the workspace
            await didChangeFoldersEmitter.fire({
                operation: FolderOperation.add,
                folder: instance(folder1),
                workspace: instance(mockedWorkspace),
            });

            expect(sut.state).to.equal(State.Running);
            expect(languageClientFactoryMock.createLanguageClient).to.have.been.calledOnceWith(
                /* id */ match.string,
                /* name */ match.string,
                /* serverOptions */ match.object,
                /* clientOptions */ match.hasNested("workspaceFolder.uri.path", "/folder1")
            );
            expect(languageClientMock.start).to.have.been.calledOnce;
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
            const sut = new LanguageClientManager(
                instance(mockedWorkspace),
                languageClientFactoryMock
            );
            await waitForReturnedPromises(languageClientMock.start);

            // Add the first folder to the workspace
            mockedTextDocument.uri = vscode.Uri.file("/folder1/file.swift");
            await didChangeFoldersEmitter.fire({
                operation: FolderOperation.add,
                folder: instance(folder1),
                workspace: instance(mockedWorkspace),
            });

            // Trigger a focus event for the second folder
            mockedTextDocument.uri = vscode.Uri.file("/folder2/file.swift");
            await didChangeFoldersEmitter.fire({
                operation: FolderOperation.focus,
                folder: instance(folder2),
                workspace: instance(mockedWorkspace),
            });

            expect(sut.state).to.equal(State.Running);
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
