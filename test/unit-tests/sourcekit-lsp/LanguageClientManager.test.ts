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

import { strict as assert } from "assert";
import * as vscode from "vscode";
import { FolderEvent, WorkspaceContext } from "../../../src/WorkspaceContext";
import {
    LanguageClientError,
    LanguageClientManager,
    SourceKitLSPErrorHandler,
} from "../../../src/sourcekit-lsp/LanguageClientManager";
import {
    anyFunction,
    anything,
    instance,
    mock,
    when,
    verify,
    anyString,
    capture,
} from "ts-mockito";
import { Version } from "../../../src/utilities/version";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { BuildFlags } from "../../../src/toolchain/BuildFlags";
import configuration from "../../../src/configuration";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";
import { eventListenerMock, mockValue, mockConstructor, mockNamespace } from "../MockUtils";
import * as languageClient from "vscode-languageclient/node";
import { FolderContext } from "../../../src/FolderContext";

suite("LanguageClientManager Suite", () => {
    let workspace: WorkspaceContext;
    let toolchain: SwiftToolchain;
    let sut: LanguageClientManager;

    const languageClientMock = mockConstructor(languageClient, "LanguageClient");
    const onDidChangeStateMock = eventListenerMock(languageClientMock, "onDidChangeState");
    const lspConfig = mockValue(configuration, "lsp");

    setup(async () => {
        workspace = mock(WorkspaceContext);
        toolchain = mock(SwiftToolchain);
        when(workspace.swiftVersion).thenReturn(new Version(6, 0, 0));
        when(toolchain.getToolchainExecutable("sourcekit-lsp")).thenReturn(
            "/path/to/toolchain/bin/sourcekit-lsp"
        );
        const toolchainInstance = instance(toolchain);
        when(toolchain.buildFlags).thenReturn(new BuildFlags(toolchainInstance));
        when(workspace.toolchain).thenReturn(toolchainInstance);
        when(workspace.outputChannel).thenReturn(new SwiftOutputChannel("Swift Test", false, 100));
        when(workspace.subscriptions).thenReturn([]);
        when(workspace.observeFolders(anything())).thenReturn(new vscode.Disposable(() => {}));

        when(languageClientMock.onNotification(anything(), anyFunction())).thenReturn(
            new vscode.Disposable(() => {})
        );
        when(languageClientMock.clientOptions).thenReturn({});
        when(languageClientMock.start).thenReturn(() => Promise.resolve());
    });

    suite("state", () => {
        setup(() => {});

        test("Not initialized yet", async () => {
            lspConfig.setValue({
                disable: true,
                serverPath: "/path/to/sourcekit-lsp",
                serverArguments: [],
                inlayHintsEnabled: false,
                supportCFamily: "disable",
                supportedLanguages: [],
            });
            sut = new LanguageClientManager(instance(workspace));

            assert.equal(sut.state, languageClient.State.Stopped);
        });

        test("Returns LanguageClient's state", async () => {
            lspConfig.setValue({
                disable: false,
                serverPath: "/path/to/sourcekit-lsp",
                serverArguments: [],
                inlayHintsEnabled: false,
                supportCFamily: "disable",
                supportedLanguages: [],
            });
            sut = new LanguageClientManager(instance(workspace));
            when(languageClientMock.state).thenReturn(languageClient.State.Running);

            assert.equal(sut.state, languageClient.State.Running);
        });
    });

    suite("onDidChangeState", () => {
        setup(() => {
            const workspaceUri = vscode.Uri.file("/path/to/workspace");
            when(languageClientMock.code2ProtocolConverter).thenReturn({
                asUri: () => workspaceUri.path,
            } as never);
            sut = new LanguageClientManager(instance(workspace));
            sut.subFolderWorkspaces.push(workspaceUri);
        });

        test("Running", async () => {
            onDidChangeStateMock.notifyAll({
                oldState: languageClient.State.Starting,
                newState: languageClient.State.Running,
            });

            verify(
                languageClientMock.sendNotification(
                    languageClient.DidChangeWorkspaceFoldersNotification.type,
                    anything()
                )
            ).once();
        });

        test("Stopped", async () => {
            onDidChangeStateMock.notifyAll({
                oldState: languageClient.State.Starting,
                newState: languageClient.State.Stopped,
            });

            verify(
                languageClientMock.sendNotification(
                    languageClient.DidChangeWorkspaceFoldersNotification.type,
                    anything()
                )
            ).never();
        });
    });

    suite("onDidChangeConfiguration", () => {
        const eventMock = mock<vscode.ConfigurationChangeEvent>();
        const onDidChangeConfigurationMock = eventListenerMock(
            vscode.workspace,
            "onDidChangeConfiguration"
        );
        const windowMock = mockNamespace(vscode, "window");

        setup(() => {
            when(eventMock.affectsConfiguration("swift.sourcekit-lsp")).thenReturn(true);
            when(eventMock.affectsConfiguration("swift.sourcekit-lsp.disable")).thenReturn(true);
            sut = new LanguageClientManager(instance(workspace));
        });

        test("Stop", async () => {
            when(languageClientMock.state).thenReturn(languageClient.State.Running);
            lspConfig.setValue({
                disable: true,
                serverPath: "/path/to/sourcekit-lsp",
                serverArguments: [],
                inlayHintsEnabled: false,
                supportCFamily: "disable",
                supportedLanguages: [],
            });

            onDidChangeConfigurationMock.notifyAll(instance(eventMock));

            verify(windowMock.showInformationMessage(anyString(), "Stop Language Server")).once();
        });

        test("Already stopped", async () => {
            when(languageClientMock.state).thenReturn(languageClient.State.Stopped);
            lspConfig.setValue({
                disable: true,
                serverPath: "/path/to/sourcekit-lsp",
                serverArguments: [],
                inlayHintsEnabled: false,
                supportCFamily: "disable",
                supportedLanguages: [],
            });

            onDidChangeConfigurationMock.notifyAll(instance(eventMock));

            verify(windowMock.showInformationMessage(anyString(), anyString())).never();
        });

        test("Start", async () => {
            when(languageClientMock.state).thenReturn(languageClient.State.Stopped);
            lspConfig.setValue({
                disable: false,
                serverPath: "/path/to/sourcekit-lsp",
                serverArguments: [],
                inlayHintsEnabled: false,
                supportCFamily: "disable",
                supportedLanguages: [],
            });

            onDidChangeConfigurationMock.notifyAll(instance(eventMock));

            verify(windowMock.showInformationMessage(anyString(), "Start Language Server")).once();
        });

        test("Restart", async () => {
            when(languageClientMock.state).thenReturn(languageClient.State.Running);
            when(eventMock.affectsConfiguration("swift.sourcekit-lsp.disable")).thenReturn(false);
            lspConfig.setValue({
                disable: false,
                serverPath: "/path/to/other/sourcekit-lsp",
                serverArguments: [],
                inlayHintsEnabled: false,
                supportCFamily: "disable",
                supportedLanguages: [],
            });

            onDidChangeConfigurationMock.notifyAll(instance(eventMock));

            verify(
                windowMock.showInformationMessage(anyString(), "Restart Language Server")
            ).once();
        });
    });

    suite("useLanguageClient", () => {
        test("Server startup succeeds", async () => {
            sut = new LanguageClientManager(instance(workspace));

            await sut.useLanguageClient(
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                async (client, token) => {
                    assert.ok(client);
                }
            );
        });

        test("Server fails to startup", async () => {
            when(languageClientMock.start).thenReturn(() => Promise.reject(new Error("Uh oh!")));
            sut = new LanguageClientManager(instance(workspace));

            // Before promise resolves, will return the error
            const error: Error = await sut
                .useLanguageClient(
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    async (client, token) => {
                        /* Ignore */
                    }
                )
                .catch(e => e);
            assert.equal(error.message, "Uh oh!");

            // Subsequent times throws `LanguageClientUnavailable`
            try {
                await sut.useLanguageClient(
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    async (client, token) => {
                        /* Ignore */
                    }
                );
                assert.fail("Language client shouldn't have started");
            } catch (e) {
                assert.equal(e, LanguageClientError.LanguageClientUnavailable);
            }
        });
    });

    test("addFolder", async () => {
        const workspaceContext = instance(workspace);
        sut = new LanguageClientManager(workspaceContext);
        const [callback] = capture(workspace.observeFolders).last();
        const folderUri = vscode.Uri.file("/path/to/folder");
        when(languageClientMock.code2ProtocolConverter).thenReturn({
            asUri: () => folderUri.path,
        } as never);
        const folderContext = mock(FolderContext);
        when(folderContext.folder).thenReturn(folderUri);

        verify(
            languageClientMock.sendNotification(
                languageClient.DidChangeWorkspaceFoldersNotification.type,
                anything()
            )
        ).never();

        await callback(instance(folderContext), FolderEvent.add, workspaceContext);

        const [type, data] = capture(languageClientMock.sendNotification).last();
        assert.equal(type, languageClient.DidChangeWorkspaceFoldersNotification.type);
        assert.equal(data.event.added[0].uri, "/path/to/folder");
    });

    test("removeFolder", async () => {
        const workspaceContext = instance(workspace);
        sut = new LanguageClientManager(workspaceContext);
        const [callback] = capture(workspace.observeFolders).last();
        const folderUri = vscode.Uri.file("/path/to/folder");
        when(languageClientMock.code2ProtocolConverter).thenReturn({
            asUri: () => folderUri.path,
        } as never);
        const folderContext = mock(FolderContext);
        when(folderContext.folder).thenReturn(folderUri);

        verify(
            languageClientMock.sendNotification(
                languageClient.DidChangeWorkspaceFoldersNotification.type,
                anything()
            )
        ).never();

        await callback(instance(folderContext), FolderEvent.remove, workspaceContext);

        const [type, data] = capture(languageClientMock.sendNotification).last();
        assert.equal(type, languageClient.DidChangeWorkspaceFoldersNotification.type);
        assert.equal(data.event.removed[0].uri, "/path/to/folder");
    });

    suite("SourceKitLSPErrorHandler", () => {
        const windowMock = mockNamespace(vscode, "window");

        suite("closed", () => {
            test("Not enabled", async () => {
                const sut = new SourceKitLSPErrorHandler(3);

                const { action } = await sut.closed();

                assert.equal(action, languageClient.CloseAction.DoNotRestart);
            });

            test("Restart, show error after out of retries", async () => {
                when(
                    windowMock.showErrorMessage(anyString(), anyString(), anyString())
                ).thenResolve();
                const sut = new SourceKitLSPErrorHandler(2);
                sut.enable();

                await sut.closed();
                verify(windowMock.showErrorMessage(anyString(), anyString(), anyString())).never();

                await sut.closed();
                verify(windowMock.showErrorMessage(anyString(), anyString(), anyString())).never();

                await sut.closed();
                verify(windowMock.showErrorMessage(anyString(), anyString(), anyString())).once();
            });

            test("Restart, restart after out of retries", async () => {
                when(windowMock.showErrorMessage(anyString(), anyString(), anyString())).thenReturn(
                    Promise.resolve("Yes")
                );
                const sut = new SourceKitLSPErrorHandler(2);
                sut.enable();

                let { action } = await sut.closed();
                assert.equal(action, languageClient.CloseAction.Restart);

                ({ action } = await sut.closed());
                assert.equal(action, languageClient.CloseAction.Restart);

                ({ action } = await sut.closed());
                assert.equal(action, languageClient.CloseAction.Restart);
            });

            test("Restart, don't restart after out of retries", async () => {
                when(windowMock.showErrorMessage(anyString(), anyString(), anyString())).thenReturn(
                    Promise.resolve("No")
                );
                const sut = new SourceKitLSPErrorHandler(2);
                sut.enable();

                let { action } = await sut.closed();
                assert.equal(action, languageClient.CloseAction.Restart);

                ({ action } = await sut.closed());
                assert.equal(action, languageClient.CloseAction.Restart);

                ({ action } = await sut.closed());
                assert.equal(action, languageClient.CloseAction.DoNotRestart);
            });
        });

        suite("error", () => {
            test("Unknown count", async () => {
                const sut = new SourceKitLSPErrorHandler(2);

                const { action } = await sut.error(new Error("Uh oh!"), undefined, undefined);

                assert.equal(action, languageClient.ErrorAction.Shutdown);
            });

            test("Remaining error count", async () => {
                const sut = new SourceKitLSPErrorHandler(2);

                const { action } = await sut.error(new Error("Uh oh!"), undefined, 2);

                assert.equal(action, languageClient.ErrorAction.Continue);
            });

            test("Surpassed error count", async () => {
                const sut = new SourceKitLSPErrorHandler(2);

                const { action } = await sut.error(new Error("Uh oh!"), undefined, 4);

                assert.equal(action, languageClient.ErrorAction.Shutdown);
            });
        });
    });
});
