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
import { randomUUID } from "crypto";
import { stub } from "sinon";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { FolderEvent, FolderOperation, WorkspaceContext } from "@src/WorkspaceContext";
import { LanguageClientToolchainCoordinator } from "@src/sourcekit-lsp/LanguageClientToolchainCoordinator";
import { SourceKitLanguageClient } from "@src/sourcekit-lsp/client/SourceKitLanguageClient";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Version } from "@src/utilities/version";

import { AsyncEventEmitter, MockedObject, instance, mockFn, mockObject } from "../../MockUtils";
import { TestLogger } from "../../utilities/TestLogger";

suite("LanguageClientToolchainCoordinator Unit Tests", () => {
    let logger: TestLogger;
    let onDidChangeFolders: AsyncEventEmitter<FolderEvent>;
    let mockedWorkspace: MockedObject<WorkspaceContext>;
    let coordinator: LanguageClientToolchainCoordinator;

    setup(() => {
        logger = new TestLogger();
        onDidChangeFolders = new AsyncEventEmitter();
        mockedWorkspace = mockObject<WorkspaceContext>({
            folders: [],
            globalToolchain: instance(
                mockObject<SwiftToolchain>({
                    swiftVersion: new Version(6, 4, 0),
                })
            ),
            globalToolchainSwiftVersion: new Version(6, 4, 0),
            logger,
            onDidChangeFolders: mockFn(s => s.callsFake(onDidChangeFolders.event)),
        });
        coordinator = new LanguageClientToolchainCoordinator(instance(mockedWorkspace), {
            createLanguageClient(toolchain) {
                const addedFolders: FolderContext[] = [];
                return instance(
                    mockObject<SourceKitLanguageClient>({
                        toolchain,
                        swiftVersion: toolchain.swiftVersion,
                        addedFolders,
                        addFolder: stub().callsFake(folder => {
                            if (addedFolders.findIndex(f => f === folder) >= 0) {
                                return;
                            }
                            addedFolders.push(folder);
                        }),
                        removeFolder: stub().callsFake(folder => {
                            const index = addedFolders.findIndex(f => f === folder);
                            if (index < 0) {
                                return;
                            }
                            addedFolders.splice(index, 1);
                        }),
                        start: mockFn(),
                        dispose: mockFn(s => s.resolves()),
                    })
                );
            },
        });
    });

    teardown(async () => {
        await coordinator.dispose();
    });

    async function addFolderToWorkspace(
        swiftVersion: Version
    ): Promise<MockedObject<FolderContext>> {
        const uuid = randomUUID();
        const mockedToolchain = mockObject<SwiftToolchain>({ swiftVersion });
        const folder = mockObject<FolderContext>({
            folder: vscode.Uri.file(`/${uuid}`),
            workspaceFolder: {
                uri: vscode.Uri.file(`/${uuid}`),
                name: "folder1",
                index: 0,
            },
            workspaceContext: instance(mockedWorkspace),
            swiftVersion,
            toolchain: instance(mockedToolchain),
            logger,
        });
        mockedWorkspace.folders.push(instance(folder));
        await onDidChangeFolders.fire({
            workspace: instance(mockedWorkspace),
            folder: instance(folder),
            operation: FolderOperation.add,
        });
        return folder;
    }

    async function removeFolderFromWorkspace(folder: MockedObject<FolderContext>): Promise<void> {
        mockedWorkspace.folders = mockedWorkspace.folders.filter(f => f !== instance(folder));
        await onDidChangeFolders.fire({
            workspace: instance(mockedWorkspace),
            folder: instance(folder),
            operation: FolderOperation.remove,
        });
    }

    async function updateSwiftVersion(
        folder: MockedObject<FolderContext>,
        swiftVersion: Version
    ): Promise<void> {
        const newToolchain = mockObject<SwiftToolchain>({ swiftVersion });
        folder.toolchain = instance(newToolchain);
        folder.swiftVersion = swiftVersion;
        await onDidChangeFolders.fire({
            workspace: instance(mockedWorkspace),
            folder: instance(folder),
            operation: FolderOperation.swiftVersionUpdated,
        });
    }

    test("immediately starts the language client when a folder is added", async function () {
        const folder = await addFolderToWorkspace(new Version(6, 4, 0));

        expect(coordinator.getAllClients()).to.have.length(1, "There should be one client");
        expect(coordinator.getClient(instance(folder)).start).to.have.been.calledOnce;
    });

    test("returns the same language client for the same folder", async function () {
        const folder = await addFolderToWorkspace(new Version(6, 4, 0));

        expect(coordinator.getAllClients()).to.have.length(1, "There should be one client");
        expect(coordinator.getClient(instance(folder))).to.equal(
            coordinator.getClient(instance(folder)),
            "Expected the same LanguageClient to be returned"
        );
    });

    test("returns the same language client for two folders with the same toolchain", async function () {
        const folder1 = await addFolderToWorkspace(new Version(6, 4, 0));
        const folder2 = await addFolderToWorkspace(new Version(6, 4, 0));

        expect(coordinator.getAllClients()).to.have.length(1, "There should be one client");
        expect(coordinator.getClient(instance(folder1))).to.equal(
            coordinator.getClient(instance(folder2)),
            "Expected the same LanguageClient to be returned"
        );
    });

    test("creates one language client for each toolchain version", async function () {
        const folder1 = await addFolderToWorkspace(new Version(5, 10, 0));
        const folder2 = await addFolderToWorkspace(new Version(6, 4, 0));

        expect(coordinator.getAllClients()).to.have.length(2, "There should be two clients");
        expect(coordinator.getClient(instance(folder1))).to.not.equal(
            coordinator.getClient(instance(folder2)),
            "Expected a different LanguageClient to be returned"
        );
    });

    test("removes a folder from its language client when it is removed from the workspace", async function () {
        const folder1 = await addFolderToWorkspace(new Version(6, 4, 0));
        const folder2 = await addFolderToWorkspace(new Version(6, 4, 0));

        const client = coordinator.getClient(instance(folder2));
        expect(client.addedFolders).to.have.length(2, "The client should have two folders");

        await removeFolderFromWorkspace(folder1);

        expect(coordinator.getAllClients()).to.have.length(1, "There should be one client");
        expect(client.addedFolders).to.have.length(1, "The client should have one folder");
    });

    test("removes and disposes of a language client when no folders remain", async function () {
        const folder1 = await addFolderToWorkspace(new Version(5, 10, 0));
        const folder2 = await addFolderToWorkspace(new Version(6, 4, 0));

        const removedClient = coordinator.getClient(instance(folder2));
        await removeFolderFromWorkspace(folder2);

        expect(coordinator.getAllClients()).to.have.length(1, "There should be one client");
        expect(coordinator.getClient(instance(folder1)).dispose).to.not.have.been.called;
        expect(removedClient.dispose).to.have.been.calledOnce;
    });

    test("removes a folder from its language client and creates a new one when its swift version changes", async function () {
        const folder1 = await addFolderToWorkspace(new Version(6, 4, 0));
        const folder2 = await addFolderToWorkspace(new Version(6, 4, 0));
        expect(coordinator.getAllClients()).to.have.length(1, "Should start with one client");

        await updateSwiftVersion(folder2, new Version(6, 3, 0));

        expect(coordinator.getAllClients()).to.have.length(2, "Should finish with two clients");
        expect(coordinator.getClient(instance(folder1))).to.not.equal(
            coordinator.getClient(instance(folder2))
        );
        expect(coordinator.getClient(instance(folder1)).addedFolders).to.have.length(1);
        expect(coordinator.getClient(instance(folder2)).addedFolders).to.have.length(1);
    });

    test("removes and disposes of a language client when no folders remain after updating a folder's swift version", async function () {
        const folder1 = await addFolderToWorkspace(new Version(5, 10, 0));
        const folder2 = await addFolderToWorkspace(new Version(6, 4, 0));

        const removedClient = coordinator.getClient(instance(folder1));
        await updateSwiftVersion(folder1, new Version(6, 4, 0));

        expect(coordinator.getAllClients()).to.have.length(1, "There should be one client");
        expect(coordinator.getClient(instance(folder1))).to.equal(
            coordinator.getClient(instance(folder2))
        );
        expect(coordinator.getClient(instance(folder1)).dispose).to.not.have.been.called;
        expect(removedClient.dispose).to.have.been.calledOnce;
    });

    test("disposes of all language clients when disposed", async function () {
        const folder1 = await addFolderToWorkspace(new Version(5, 10, 0));
        const folder2 = await addFolderToWorkspace(new Version(6, 4, 0));

        const client1 = coordinator.getClient(instance(folder1));
        const client2 = coordinator.getClient(instance(folder2));
        await coordinator.dispose();

        expect(coordinator.getAllClients()).to.have.length(0, "There should be no clients");
        expect(client1.dispose).to.have.been.calledOnce;
        expect(client2.dispose).to.have.been.calledOnce;
    });
});
