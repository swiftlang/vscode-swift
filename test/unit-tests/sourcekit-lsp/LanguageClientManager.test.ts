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
    doNothing,
    mockModule,
    waitForReturnedPromises,
    AsyncEventEmitter,
    mockNamespace,
    mockValue,
} from "../MockUtils2";
import * as langClient from "vscode-languageclient/node";
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

suite("LanguageClientManager Suite", () => {
    let languageClientMock: MockedObject<LanguageClient>;
    let mockedConverter: MockedObject<Code2ProtocolConverter>;
    let changeStateEmitter: AsyncEventEmitter<StateChangeEvent>;
    let mockedWorkspace: MockedObject<WorkspaceContext>;
    let didChangeFoldersEmitter: AsyncEventEmitter<FolderEvent>;
    let mockedOutputChannel: MockedObject<SwiftOutputChannel>;
    let mockedToolchain: MockedObject<SwiftToolchain>;
    let mockedBuildFlags: MockedObject<BuildFlags>;

    const mockedLangClientModule = mockModule(langClient);
    const mockedConfig = mockModule(configuration);
    const mockedEnvironment = mockValue(process, "env");
    const mockedLspConfig = mockNamespace(configuration, "lsp");
    const mockedVSCodeWindow = mockNamespace(vscode, "window");
    const mockedVSCodeExtensions = mockNamespace(vscode, "extensions");
    const mockedVSCodeWorkspace = mockNamespace(vscode, "workspace");
    let changeConfigEmitter: AsyncEventEmitter<vscode.ConfigurationChangeEvent>;
    let createFilesEmitter: AsyncEventEmitter<vscode.FileCreateEvent>;
    let deleteFilesEmitter: AsyncEventEmitter<vscode.FileDeleteEvent>;

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
            buildPathFlags: doNothing(),
            swiftDriverSDKFlags: doNothing(),
            swiftDriverTargetFlags: doNothing(),
        });
        mockedBuildFlags.buildPathFlags.returns([]);
        mockedBuildFlags.swiftDriverSDKFlags.returns([]);
        mockedBuildFlags.swiftDriverTargetFlags.returns([]);
        mockedToolchain = mockObject<SwiftToolchain>({
            swiftVersion: new Version(6, 0, 0),
            buildFlags: mockedBuildFlags,
            getToolchainExecutable: doNothing(),
        });
        mockedToolchain.getToolchainExecutable
            .withArgs("sourcekit-lsp")
            .returns("/path/to/toolchain/bin/sourcekit-lsp");
        mockedOutputChannel = mockObject<SwiftOutputChannel>({
            log: doNothing(),
            logDiagnostic: doNothing(),
        });
        mockedWorkspace = mockObject<WorkspaceContext>({
            toolchain: instance(mockedToolchain),
            swiftVersion: new Version(6, 0, 0),
            outputChannel: instance(mockedOutputChannel),
            subscriptions: [],
            folders: [],
            onDidChangeFolders: doNothing(),
        });
        didChangeFoldersEmitter = new AsyncEventEmitter();
        mockedWorkspace.onDidChangeFolders.callsFake(didChangeFoldersEmitter.event);
        mockedConverter = mockObject<Code2ProtocolConverter>({
            asUri: doNothing(),
        });
        mockedConverter.asUri.callsFake(uri => uri.fsPath);
        changeStateEmitter = new AsyncEventEmitter();
        languageClientMock = mockObject<LanguageClient>({
            state: State.Stopped,
            code2ProtocolConverter: instance(mockedConverter),
            clientOptions: {},
            outputChannel: instance(
                mockObject<vscode.OutputChannel>({
                    dispose: doNothing(),
                })
            ),
            start: doNothing(),
            stop: doNothing(),
            onRequest: doNothing(),
            sendNotification: doNothing(),
            onNotification: doNothing(),
            onDidChangeState: doNothing(),
        });
        languageClientMock.start.callsFake(async () => {
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
        });
        languageClientMock.stop.callsFake(async () => {
            const oldState = languageClientMock.state;
            languageClientMock.state = State.Stopped;
            await changeStateEmitter.fire({
                oldState,
                newState: State.Stopped,
            });
        });
        languageClientMock.onDidChangeState.callsFake(changeStateEmitter.event);
        languageClientMock.onNotification.returns(new vscode.Disposable(() => {}));
        languageClientMock.sendNotification.resolves();
        // `new LanguageClient()` will always return the mocked LanguageClient
        mockedLangClientModule.LanguageClient.returns(instance(languageClientMock));
        // LSP configuration defaults
        mockedConfig.path = "";
        mockedConfig.buildArguments = [];
        mockedConfig.backgroundIndexing = false;
        mockedConfig.swiftEnvironmentVariables = {};
        mockedLspConfig.supportCFamily = "cpptools-inactive";
        mockedLspConfig.disable = false;
        mockedLspConfig.serverPath = "";
        mockedLspConfig.serverArguments = [];
        // Process environment variables
        mockedEnvironment.setValue({});
    });

    test("launches SourceKit-LSP on startup", async () => {
        const sut = new LanguageClientManager(instance(mockedWorkspace));
        await waitForReturnedPromises(languageClientMock.start);

        expect(sut.state).to.equal(State.Running);
        expect(mockedLangClientModule.LanguageClient).to.have.been.calledOnceWith(
            /* id */ match.string,
            /* name */ match.string,
            /* serverOptions */ match.has("command", "/path/to/toolchain/bin/sourcekit-lsp"),
            /* clientOptions */ match.object
        );
        expect(languageClientMock.start).to.have.been.calledOnce;
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
        new LanguageClientManager(instance(mockedWorkspace));
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
        const sut = new LanguageClientManager(instance(mockedWorkspace));
        await waitForReturnedPromises(languageClientMock.start);

        expect(sut.state).to.equal(State.Stopped);
        expect(mockedLangClientModule.LanguageClient).to.not.have.been.called;
        expect(languageClientMock.start).to.not.have.been.called;
    });

    test("user can provide a custom SourceKit-LSP executable", async () => {
        mockedLspConfig.serverPath = "/path/to/my/custom/sourcekit-lsp";
        const sut = new LanguageClientManager(instance(mockedWorkspace));
        await waitForReturnedPromises(languageClientMock.start);

        expect(sut.state).to.equal(State.Running);
        expect(mockedLangClientModule.LanguageClient).to.have.been.calledOnceWith(
            /* id */ match.string,
            /* name */ match.string,
            /* serverOptions */ match.has("command", "/path/to/my/custom/sourcekit-lsp"),
            /* clientOptions */ match.object
        );
        expect(languageClientMock.start).to.have.been.calledOnce;
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
            const sut = new LanguageClientManager(instance(mockedWorkspace));
            await waitForReturnedPromises(languageClientMock.start);

            expect(sut.state).to.equal(State.Stopped);
            expect(mockedLangClientModule.LanguageClient).to.not.have.been.called;
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
            const sut = new LanguageClientManager(instance(mockedWorkspace));
            await waitForReturnedPromises(languageClientMock.start);

            // Add the folder to the workspace
            await didChangeFoldersEmitter.fire({
                operation: FolderOperation.add,
                folder: instance(folder1),
                workspace: instance(mockedWorkspace),
            });

            expect(sut.state).to.equal(State.Running);
            expect(mockedLangClientModule.LanguageClient).to.have.been.calledOnceWith(
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
            const sut = new LanguageClientManager(instance(mockedWorkspace));
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
            expect(mockedLangClientModule.LanguageClient).to.have.been.calledTwice;
            expect(mockedLangClientModule.LanguageClient).to.have.been.calledWith(
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
