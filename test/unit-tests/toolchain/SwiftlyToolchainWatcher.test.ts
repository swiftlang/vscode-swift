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
import * as fs from "fs/promises";
import * as path from "path";
import { SinonFakeTimers, useFakeTimers } from "sinon";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { InternalSwiftExtensionApi } from "@src/InternalSwiftExtensionApi";
import { FolderOperation, ToolchainManager } from "@src/SwiftExtensionApi";
import { FolderEvent, WorkspaceContext } from "@src/WorkspaceContext";
import { SwiftlyToolchainWatcher } from "@src/toolchain/SwiftlyToolchainWatcher";
import { Swiftly } from "@src/toolchain/swiftly";
import { SwiftToolchain } from "@src/toolchain/toolchain";

import {
    MockedObject,
    instance,
    mockFn,
    mockGlobalModule,
    mockGlobalObject,
    mockObject,
} from "../../MockUtils";

suite("Swiftly Toolchain Watcher", () => {
    const mockFS = mockGlobalModule(fs);
    const mockSwiftly = mockGlobalModule(Swiftly);
    const mockWorkspace = mockGlobalObject(vscode, "workspace");
    let fileSystemWatchers: Map<
        string,
        { watcher: MockedObject<vscode.FileSystemWatcher>; eventEmitter: vscode.EventEmitter<void> }
    >;
    let onDidChangeWorkspaceEmitter: vscode.EventEmitter<WorkspaceContext>;
    let mockSwiftExtensionApi: MockedObject<InternalSwiftExtensionApi>;
    let addedFolders: Map<string, MockedObject<FolderContext>>;
    let timers: SinonFakeTimers;

    setup(function () {
        mockFS.readFile.rejects(Error("No such file or directory"));
        mockSwiftly.isSupported.returns(true);
        fileSystemWatchers = new Map();
        mockWorkspace.createFileSystemWatcher.callsFake(pattern => {
            const folder = path.basename((pattern as vscode.RelativePattern).baseUri.fsPath);
            const eventEmitter = new vscode.EventEmitter<void>();
            const mockFSWatcher = mockObject<vscode.FileSystemWatcher>({
                onDidChange: mockFn(s => s.callsFake(eventEmitter.event.bind(eventEmitter))),
                onDidCreate: mockFn(),
                onDidDelete: mockFn(),
                dispose: mockFn(s => s.callsFake(() => fileSystemWatchers.delete(folder))),
            });
            fileSystemWatchers.set(folder, { watcher: mockFSWatcher, eventEmitter });
            return instance(mockFSWatcher);
        });
        onDidChangeWorkspaceEmitter = new vscode.EventEmitter();
        mockSwiftExtensionApi = mockObject<InternalSwiftExtensionApi>({
            onDidChangeWorkspaceContext: mockFn(s =>
                s.callsFake(onDidChangeWorkspaceEmitter.event.bind(onDidChangeWorkspaceEmitter))
            ),
            workspaceContext: undefined,
            reloadWorkspaceContext: mockFn(),
        });
        addedFolders = new Map();
        timers = useFakeTimers();
    });

    teardown(() => {
        timers.restore();
    });

    async function run(
        events: (
            | { type: "globalToolchainChanged"; version: string | undefined }
            | {
                  type: "localToolchainChanged";
                  folderName: string;
                  version: string | undefined;
              }
            | {
                  type: "workspaceContextChanged";
                  version: string | undefined;
                  manager: ToolchainManager;
              }
            | {
                  type: "addFolder";
                  folderName: string;
                  version: string | undefined;
                  manager: ToolchainManager;
              }
            | { type: "removeFolder"; folderName: string }
        )[]
    ) {
        let mockWorkspaceContext: MockedObject<WorkspaceContext> | undefined;
        const onDidChangeFoldersEmitter = new vscode.EventEmitter<FolderEvent>();
        const watcher = new SwiftlyToolchainWatcher(instance(mockSwiftExtensionApi));
        async function runUntilNextCheck(): Promise<void> {
            // Allow some time for any Promises to complete.
            await timers.tickAsync(1);
            await timers.tickAsync(1);
            await timers.tickAsync(1);
            // Advance time to the next check
            await timers.nextAsync();
            // Allow some time for any Promises to complete.
            await timers.tickAsync(1);
            await timers.tickAsync(1);
            await timers.tickAsync(1);
        }

        try {
            for (const event of events) {
                switch (event.type) {
                    case "workspaceContextChanged": {
                        mockSwiftly.inUseVersion.resolves(event.version);
                        addedFolders.clear();
                        mockWorkspaceContext = mockObject<WorkspaceContext>({
                            onDidChangeFolders: mockFn(s =>
                                s.callsFake(
                                    onDidChangeFoldersEmitter.event.bind(onDidChangeFoldersEmitter)
                                )
                            ),
                            globalToolchain: instance(
                                mockObject<SwiftToolchain>({ manager: event.manager })
                            ),
                        });
                        mockSwiftExtensionApi.workspaceContext = instance(mockWorkspaceContext);
                        onDidChangeWorkspaceEmitter.fire(instance(mockWorkspaceContext));
                        break;
                    }
                    case "addFolder": {
                        if (!mockWorkspaceContext) {
                            throw Error("No workspace context was found.");
                        }
                        const folderPath = path.join("/", event.folderName);
                        mockFS.readFile
                            .withArgs(path.join(folderPath, ".swift-version"))
                            .resolves(event.version);
                        const folderContext = mockObject<FolderContext>({
                            folder: vscode.Uri.file(folderPath),
                            toolchain: instance(
                                mockObject<SwiftToolchain>({
                                    manager: event.manager,
                                })
                            ),
                            reloadToolchain: mockFn(),
                        });
                        addedFolders.set(event.folderName, folderContext);
                        onDidChangeFoldersEmitter.fire({
                            workspace: instance(mockWorkspaceContext),
                            folder: instance(folderContext),
                            operation: FolderOperation.add,
                        });
                        break;
                    }
                    case "removeFolder": {
                        if (!mockWorkspaceContext) {
                            throw Error("No workspace context was found.");
                        }
                        const folderContext = addedFolders.get(event.folderName);
                        if (!folderContext) {
                            throw Error(
                                `No folder with name "${event.folderName}" could be found.`
                            );
                        }
                        onDidChangeFoldersEmitter.fire({
                            workspace: instance(mockWorkspaceContext),
                            folder: instance(folderContext),
                            operation: FolderOperation.remove,
                        });
                        break;
                    }
                    case "globalToolchainChanged": {
                        mockSwiftly.inUseVersion.resolves(event.version);
                        break;
                    }
                    case "localToolchainChanged": {
                        const swiftVersionPath = path.join("/", event.folderName, ".swift-version");
                        mockFS.readFile.withArgs(swiftVersionPath).resolves(event.version);
                        fileSystemWatchers.get(event.folderName)?.eventEmitter.fire();
                        break;
                    }
                }
                await runUntilNextCheck();
            }
        } finally {
            watcher.dispose();
            expect(timers.countTimers()).to.equal(0, "Some timers were not disposed");
            expect(fileSystemWatchers.size).to.equal(
                0,
                "Some FileSystem watchers were not disposed"
            );
        }
    }

    test("ignores all changes if swiftly is not supported", async () => {
        mockSwiftly.isSupported.returns(false);
        await run([
            { type: "globalToolchainChanged", version: "6.3" },
            { type: "globalToolchainChanged", version: "6.2" },
        ]);

        expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
    });

    test("disposes of all FileSystem watchers when many workspace change events occur", async () => {
        // The expectation for disposal happens inside of run()
        await run([
            { type: "workspaceContextChanged", version: "6.3", manager: "swiftly" },
            { type: "addFolder", folderName: "1", version: "6.3", manager: "swiftly" },
            { type: "addFolder", folderName: "2", version: "6.3", manager: "swiftly" },
            { type: "removeFolder", folderName: "1" },
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folderName: "1", version: "6.3", manager: "swiftly" },
            { type: "addFolder", folderName: "2", version: "6.3", manager: "swiftly" },
            { type: "removeFolder", folderName: "1" },
            { type: "workspaceContextChanged", version: "6.1", manager: "swiftly" },
        ]);
    });

    test("detects changes to the global swiftly toolchain", async () => {
        await run([
            { type: "globalToolchainChanged", version: "6.3" },
            { type: "globalToolchainChanged", version: "6.2" },
        ]);

        expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.have.been.calledOnce;
    });

    test("ignores changes to the global swiftly toolchain if the global toolchain is not managed by swiftly", async () => {
        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftenv" },
            { type: "globalToolchainChanged", version: "6.3" },
            { type: "workspaceContextChanged", version: "6.2", manager: "unknown" },
            { type: "globalToolchainChanged", version: "6.1" },
            { type: "workspaceContextChanged", version: "6.2", manager: "xcrun" },
            { type: "globalToolchainChanged", version: "6.4" },
        ]);

        expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
    });

    test("detects changes to a local swiftly toolchain", async () => {
        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folderName: "1", version: "6.2", manager: "swiftly" },
            { type: "localToolchainChanged", folderName: "1", version: "6.3" },
        ]);

        expect(addedFolders.get("1")?.reloadToolchain).to.have.been.calledOnce;
    });
});
