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
import { SwiftLogger } from "@src/logging/SwiftLogger";
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

/** Creates a URI for an absolute path made up of the given path segments. */
function uri(...segments: string[]): vscode.Uri {
    return vscode.Uri.file(path.resolve(path.sep, ...segments));
}

/** The directory that contains the given folder. */
function parentOf(folder: vscode.Uri): vscode.Uri {
    return vscode.Uri.file(path.dirname(folder.fsPath));
}

suite("Swiftly Toolchain Watcher", () => {
    const mockFS = mockGlobalModule(fs);
    const mockSwiftly = mockGlobalModule(Swiftly);
    const mockWorkspace = mockGlobalObject(vscode, "workspace");
    let fileSystemWatchers: Map<
        string,
        {
            watcher: MockedObject<vscode.FileSystemWatcher>;
            onDidCreate: vscode.EventEmitter<void>;
            onDidChange: vscode.EventEmitter<void>;
            onDidDelete: vscode.EventEmitter<void>;
        }
    >;
    let swiftVersionFiles: Map<string, string>;
    let onDidChangeWorkspaceEmitter: vscode.EventEmitter<WorkspaceContext>;
    let onDidChangeConfigurationEmitter: vscode.EventEmitter<vscode.ConfigurationChangeEvent>;
    let mockSwiftExtensionApi: MockedObject<InternalSwiftExtensionApi>;
    let mockSwiftConfig: MockedObject<vscode.WorkspaceConfiguration>;
    let addedFolders: Map<string, MockedObject<FolderContext>>;
    let timers: SinonFakeTimers;

    /**
     * Sets the contents of the `.swift-version` file within the given directory, or removes
     * the file entirely when the version is `undefined`.
     */
    function writeSwiftVersionFile(directory: vscode.Uri, version: string | undefined): void {
        const versionFile = path.join(directory.fsPath, ".swift-version");
        if (version === undefined) {
            swiftVersionFiles.delete(versionFile);
            const error: NodeJS.ErrnoException = new Error(
                `ENOENT: no such file or directory, open '${versionFile}'`
            );
            error.code = "ENOENT";
            mockFS.readFile.withArgs(versionFile).rejects(error);
        } else {
            swiftVersionFiles.set(versionFile, version);
            mockFS.readFile.withArgs(versionFile).resolves(version);
        }
    }

    setup(function () {
        const enoent: NodeJS.ErrnoException = new Error("No such file or directory");
        enoent.code = "ENOENT";
        mockFS.readFile.rejects(enoent);
        swiftVersionFiles = new Map();
        fileSystemWatchers = new Map();
        mockWorkspace.createFileSystemWatcher.callsFake(pattern => {
            const directory = (pattern as vscode.RelativePattern).baseUri.fsPath;
            const emitters = {
                onDidCreate: new vscode.EventEmitter<void>(),
                onDidChange: new vscode.EventEmitter<void>(),
                onDidDelete: new vscode.EventEmitter<void>(),
            };
            const mockFSWatcher = mockObject<vscode.FileSystemWatcher>({
                onDidCreate: mockFn(s =>
                    s.callsFake(emitters.onDidCreate.event.bind(emitters.onDidCreate))
                ),
                onDidChange: mockFn(s =>
                    s.callsFake(emitters.onDidChange.event.bind(emitters.onDidChange))
                ),
                onDidDelete: mockFn(s =>
                    s.callsFake(emitters.onDidDelete.event.bind(emitters.onDidDelete))
                ),
                dispose: mockFn(s => s.callsFake(() => fileSystemWatchers.delete(directory))),
            });
            fileSystemWatchers.set(directory, { watcher: mockFSWatcher, ...emitters });
            return instance(mockFSWatcher);
        });
        mockSwiftConfig = mockObject<vscode.WorkspaceConfiguration>({
            get: mockFn(s => s.callsFake((_section, defaultValue) => defaultValue)),
        });
        mockWorkspace.getConfiguration.returns(instance(mockSwiftConfig));
        onDidChangeConfigurationEmitter = new vscode.EventEmitter();
        mockWorkspace.onDidChangeConfiguration.callsFake(
            onDidChangeConfigurationEmitter.event.bind(onDidChangeConfigurationEmitter)
        );
        onDidChangeWorkspaceEmitter = new vscode.EventEmitter();
        mockSwiftExtensionApi = mockObject<InternalSwiftExtensionApi>({
            logger: instance(mockObject<SwiftLogger>({ error: mockFn(), warn: mockFn() })),
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

    /** A folder that is present in the workspace. */
    type FolderDescription = {
        folder: vscode.Uri;
        version?: string;
        manager: ToolchainManager;
    };

    type WatcherEvent =
        | { type: "globalToolchainChanged"; version: string | undefined }
        | {
              type: "swiftVersionFileChanged";
              directory: vscode.Uri;
              version: string | undefined;
          }
        | {
              type: "workspaceContextChanged";
              version: string | undefined;
              manager: ToolchainManager;
              /**
               * Folders that have already been added to the new workspace context before the
               * watcher has had a chance to subscribe to its events.
               */
              existingFolders?: FolderDescription[];
          }
        | ({ type: "addFolder" } & FolderDescription)
        | { type: "removeFolder"; folder: vscode.Uri }
        | { type: "configurationChanged"; setting: string; value: unknown }
        | { type: "checkpoint"; check: () => void };

    async function run(events: WatcherEvent[]) {
        let mockWorkspaceContext: MockedObject<WorkspaceContext> | undefined;
        let workspaceFolders: FolderContext[] = [];
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

        function requireWorkspaceContext(): MockedObject<WorkspaceContext> {
            if (!mockWorkspaceContext) {
                throw Error("No workspace context was found.");
            }
            return mockWorkspaceContext;
        }

        function changeWorkspaceContext(
            event: Extract<WatcherEvent, { type: "workspaceContextChanged" }>
        ): void {
            mockSwiftly.inUseVersion.resolves(event.version);
            addedFolders.clear();
            workspaceFolders = [];
            const existingFolders = (event.existingFolders ?? []).map(createFolderContext);
            mockWorkspaceContext = mockObject<WorkspaceContext>({
                onDidChangeFolders: mockFn(s =>
                    s.callsFake((listener, thisArg, disposables) => {
                        // WorkspaceContext replays an add event for every folder that it already
                        // holds whenever a new listener subscribes, so that folders added during
                        // activation aren't missed. See https://github.com/swiftlang/vscode-swift/issues/1944
                        for (const folderContext of existingFolders) {
                            listener.call(thisArg, {
                                workspace: instance(requireWorkspaceContext()),
                                folder: instance(folderContext),
                                operation: FolderOperation.add,
                            });
                        }
                        return onDidChangeFoldersEmitter.event(listener, thisArg, disposables);
                    })
                ),
                folders: workspaceFolders,
                globalToolchain: instance(mockObject<SwiftToolchain>({ manager: event.manager })),
            });
            mockSwiftExtensionApi.workspaceContext = instance(mockWorkspaceContext);
            onDidChangeWorkspaceEmitter.fire(instance(mockWorkspaceContext));
        }

        function createFolderContext(folder: FolderDescription): MockedObject<FolderContext> {
            if (folder.version !== undefined) {
                writeSwiftVersionFile(folder.folder, folder.version);
            }
            const folderContext = mockObject<FolderContext>({
                folder: folder.folder,
                workspaceFolder: instance(
                    mockObject<vscode.WorkspaceFolder>({
                        uri: folder.folder,
                        name: path.basename(folder.folder.fsPath),
                        index: addedFolders.size,
                    })
                ),
                toolchain: instance(mockObject<SwiftToolchain>({ manager: folder.manager })),
                reloadToolchain: mockFn(),
            });
            addedFolders.set(folder.folder.fsPath, folderContext);
            workspaceFolders.push(instance(folderContext));
            return folderContext;
        }

        function addFolder(event: Extract<WatcherEvent, { type: "addFolder" }>): void {
            const workspace = requireWorkspaceContext();
            const folderContext = createFolderContext(event);
            onDidChangeFoldersEmitter.fire({
                workspace: instance(workspace),
                folder: instance(folderContext),
                operation: FolderOperation.add,
            });
        }

        function removeFolder(event: Extract<WatcherEvent, { type: "removeFolder" }>): void {
            const workspace = requireWorkspaceContext();
            const folderContext = addedFolders.get(event.folder.fsPath);
            if (!folderContext) {
                throw Error(`No folder at "${event.folder.fsPath}" could be found.`);
            }
            workspaceFolders = workspaceFolders.filter(
                f => f.folder.fsPath !== event.folder.fsPath
            );
            workspace.folders = workspaceFolders;
            onDidChangeFoldersEmitter.fire({
                workspace: instance(workspace),
                folder: instance(folderContext),
                operation: FolderOperation.remove,
            });
        }

        function changeConfiguration(
            event: Extract<WatcherEvent, { type: "configurationChanged" }>
        ): void {
            mockSwiftConfig.get.withArgs(event.setting).returns(event.value);
            onDidChangeConfigurationEmitter.fire(
                instance(
                    mockObject<vscode.ConfigurationChangeEvent>({
                        affectsConfiguration: mockFn(s =>
                            s.callsFake(section => section === `swift.${event.setting}`)
                        ),
                    })
                )
            );
        }

        function changeSwiftVersionFile(
            event: Extract<WatcherEvent, { type: "swiftVersionFileChanged" }>
        ): void {
            const versionFile = path.join(event.directory.fsPath, ".swift-version");
            const existed = swiftVersionFiles.has(versionFile);
            writeSwiftVersionFile(event.directory, event.version);
            const emitters = fileSystemWatchers.get(event.directory.fsPath);
            if (event.version === undefined) {
                emitters?.onDidDelete.fire();
            } else if (existed) {
                emitters?.onDidChange.fire();
            } else {
                emitters?.onDidCreate.fire();
            }
        }

        try {
            for (const event of events) {
                switch (event.type) {
                    case "workspaceContextChanged":
                        changeWorkspaceContext(event);
                        break;
                    case "addFolder":
                        addFolder(event);
                        break;
                    case "removeFolder":
                        removeFolder(event);
                        break;
                    case "globalToolchainChanged":
                        mockSwiftly.inUseVersion.resolves(event.version);
                        break;
                    case "swiftVersionFileChanged":
                        changeSwiftVersionFile(event);
                        break;
                    case "configurationChanged":
                        changeConfiguration(event);
                        break;
                    case "checkpoint":
                        event.check();
                        break;
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

    test("disposes of all FileSystem watchers when many workspace change events occur", async () => {
        // The expectation for disposal happens inside of run()
        await run([
            { type: "workspaceContextChanged", version: "6.3", manager: "swiftly" },
            { type: "addFolder", folder: uri("1"), version: "6.3", manager: "swiftly" },
            { type: "addFolder", folder: uri("2"), version: "6.3", manager: "swiftly" },
            { type: "removeFolder", folder: uri("1") },
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder: uri("1"), version: "6.3", manager: "swiftly" },
            { type: "addFolder", folder: uri("2"), version: "6.3", manager: "swiftly" },
            { type: "removeFolder", folder: uri("1") },
            {
                type: "workspaceContextChanged",
                version: "6.1",
                manager: "swiftly",
                existingFolders: [{ folder: uri("3"), version: "6.1", manager: "swiftly" }],
            },
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
        const folder = uri("1");
        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, version: "6.2", manager: "swiftly" },
            { type: "swiftVersionFileChanged", directory: folder, version: "6.3" },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.have.been.calledOnce;
    });

    test("watches folders that were added before the workspace context changed", async () => {
        const folder = uri("1");
        await run([
            {
                type: "workspaceContextChanged",
                version: "6.2",
                manager: "swiftly",
                existingFolders: [{ folder, version: "6.2", manager: "swiftly" }],
            },
            { type: "swiftVersionFileChanged", directory: folder, version: "6.3" },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.have.been.calledOnce;
    });

    test("ignores changes to a local swiftly toolchain if the folder is not managed by swiftly", async () => {
        const folder = uri("1");
        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, version: "6.2", manager: "xcrun" },
            { type: "swiftVersionFileChanged", directory: folder, version: "6.3" },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.not.have.been.called;
    });

    test("detects changes to a .swift-version file above the root of a folder", async () => {
        const folder1 = uri("root", "MyFolder1");
        const folder2 = uri("root", "MyFolder2");
        const root = parentOf(folder1);
        writeSwiftVersionFile(root, "6.2");

        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder: folder1, manager: "swiftly" },
            { type: "addFolder", folder: folder2, manager: "swiftly" },
            { type: "swiftVersionFileChanged", directory: root, version: "6.3" },
        ]);

        expect(addedFolders.get(folder1.fsPath)?.reloadToolchain).to.have.been.calledOnce;
        expect(addedFolders.get(folder2.fsPath)?.reloadToolchain).to.have.been.calledOnce;
    });

    test("only reloads the folders that a .swift-version file applies to", async () => {
        const folder1 = uri("root", "MyFolder1");
        const folder2 = uri("root", "MyFolder2");
        writeSwiftVersionFile(parentOf(folder1), "6.2");

        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder: folder1, manager: "swiftly" },
            { type: "addFolder", folder: folder2, manager: "swiftly" },
            { type: "swiftVersionFileChanged", directory: folder1, version: "6.3" },
        ]);

        expect(addedFolders.get(folder1.fsPath)?.reloadToolchain).to.have.been.calledOnce;
        expect(addedFolders.get(folder2.fsPath)?.reloadToolchain).to.not.have.been.called;
    });

    test("prefers the nearest .swift-version file and falls back to the parent when it is deleted", async () => {
        const folder = uri("root", "MyFolder1");
        const root = parentOf(folder);
        writeSwiftVersionFile(root, "6.2");

        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, manager: "swiftly" },
            // Shadow the parent's .swift-version file
            { type: "swiftVersionFileChanged", directory: folder, version: "6.3" },
            // Changing the now shadowed parent has no effect
            { type: "swiftVersionFileChanged", directory: root, version: "6.1" },
            // Deleting the nearest file falls back to the parent's version
            { type: "swiftVersionFileChanged", directory: folder, version: undefined },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.have.been.calledTwice;
    });

    test("detects a .swift-version file being created and deleted", async () => {
        const folder = uri("1");
        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, manager: "swiftly" },
            { type: "swiftVersionFileChanged", directory: folder, version: "6.3" },
            { type: "swiftVersionFileChanged", directory: folder, version: undefined },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.have.been.calledTwice;
    });

    test("ignores a .swift-version file being written with the same version", async () => {
        const folder = uri("1");
        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, version: "6.2", manager: "swiftly" },
            { type: "swiftVersionFileChanged", directory: folder, version: "6.2" },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.not.have.been.called;
    });

    test("does not reload while a .swift-version file is still being written", async () => {
        const folder = uri("1");
        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, manager: "swiftly" },
            // Swiftly.use() creates the file before asking swiftly to populate it, so an empty
            // file is a write that is still in progress and must not trigger a reload.
            { type: "swiftVersionFileChanged", directory: folder, version: "" },
            {
                type: "checkpoint",
                check() {
                    expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.not.have.been
                        .called;
                },
            },
            { type: "swiftVersionFileChanged", directory: folder, version: "6.3" },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.have.been.calledOnce;
    });

    test("does not leak watchers when the same folder is added twice", async () => {
        const folder = uri("root", "MyFolder1");

        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, manager: "swiftly" },
            { type: "addFolder", folder, manager: "swiftly" },
            // A duplicate add must not acquire a second reference to the search path, otherwise
            // removing the folder once would leave its watchers behind.
            { type: "removeFolder", folder },
            {
                type: "checkpoint",
                check() {
                    expect(fileSystemWatchers.size).to.equal(0);
                },
            },
        ]);
    });

    test("shares a single FileSystem watcher between folders with a common parent", async () => {
        const folder1 = uri("root", "MyFolder1");
        const folder2 = uri("root", "MyFolder2");
        const root = parentOf(folder1);

        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder: folder1, manager: "swiftly" },
            { type: "addFolder", folder: folder2, manager: "swiftly" },
            {
                type: "checkpoint",
                check() {
                    // Directories shared by both folders are only ever watched once
                    expect(mockWorkspace.createFileSystemWatcher).to.have.callCount(
                        fileSystemWatchers.size
                    );
                    expect([...fileSystemWatchers.keys()]).to.include.members([
                        folder1.fsPath,
                        folder2.fsPath,
                        root.fsPath,
                    ]);
                },
            },
            { type: "removeFolder", folder: folder2 },
            {
                type: "checkpoint",
                check() {
                    // The shared parent is still needed by the remaining folder
                    expect([...fileSystemWatchers.keys()]).to.include.members([
                        folder1.fsPath,
                        root.fsPath,
                    ]);
                    expect([...fileSystemWatchers.keys()]).to.not.include(folder2.fsPath);
                },
            },
        ]);
    });

    test("watches every directory up to the root of the file system by default", async () => {
        const folder = uri("a", "b", "c", "d", "e", "f", "g");
        // The root of the file system, which is as far as the watch can ever reach.
        const root = uri();

        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, manager: "swiftly" },
            {
                type: "checkpoint",
                check() {
                    expect([...fileSystemWatchers.keys()]).to.have.members([
                        folder.fsPath,
                        uri("a", "b", "c", "d", "e", "f").fsPath,
                        uri("a", "b", "c", "d", "e").fsPath,
                        uri("a", "b", "c", "d").fsPath,
                        uri("a", "b", "c").fsPath,
                        uri("a", "b").fsPath,
                        uri("a").fsPath,
                        root.fsPath,
                    ]);
                },
            },
            { type: "swiftVersionFileChanged", directory: root, version: "6.3" },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.have.been.calledOnce;
    });

    test("stops watching once maxSwiftVersionFileWatchDepth directories have been watched", async () => {
        const folder = uri("a", "b", "c", "d", "e", "f", "g");
        // The fifth and furthest directory that is watched.
        const furthest = uri("a", "b", "c");
        // One directory too far to be watched.
        const beyondLimit = parentOf(furthest);
        mockSwiftConfig.get.withArgs("maxSwiftVersionFileWatchDepth").returns(5);

        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, manager: "swiftly" },
            {
                type: "checkpoint",
                check() {
                    expect([...fileSystemWatchers.keys()]).to.have.members([
                        folder.fsPath,
                        uri("a", "b", "c", "d", "e", "f").fsPath,
                        uri("a", "b", "c", "d", "e").fsPath,
                        uri("a", "b", "c", "d").fsPath,
                        furthest.fsPath,
                    ]);
                },
            },
            // A .swift-version file above the limit is neither watched nor read
            { type: "swiftVersionFileChanged", directory: beyondLimit, version: "6.3" },
            {
                type: "checkpoint",
                check() {
                    expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.not.have.been
                        .called;
                },
            },
            // The furthest directory within the limit is still watched
            { type: "swiftVersionFileChanged", directory: furthest, version: "6.4" },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.have.been.calledOnce;
    });

    test("watches the folder only when maxSwiftVersionFileWatchDepth is one", async () => {
        const folder = uri("a", "b", "c");
        mockSwiftConfig.get.withArgs("maxSwiftVersionFileWatchDepth").returns(1);

        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, manager: "swiftly" },
            {
                type: "checkpoint",
                check() {
                    expect([...fileSystemWatchers.keys()]).to.have.members([folder.fsPath]);
                },
            },
            // The parent is no longer watched, so its .swift-version file is ignored
            { type: "swiftVersionFileChanged", directory: parentOf(folder), version: "6.3" },
            {
                type: "checkpoint",
                check() {
                    expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.not.have.been
                        .called;
                },
            },
            { type: "swiftVersionFileChanged", directory: folder, version: "6.4" },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.have.been.calledOnce;
    });

    test("does not watch folders that are ignoring .swift-version files", async () => {
        const folder = uri("1");
        mockSwiftConfig.get.withArgs("ignoreSwiftVersionFile").returns(true);

        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, version: "6.2", manager: "swiftly" },
            { type: "swiftVersionFileChanged", directory: folder, version: "6.3" },
        ]);

        expect(fileSystemWatchers.size).to.equal(0);
        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.not.have.been.called;
    });

    test("rewatches folders when maxSwiftVersionFileWatchDepth changes", async () => {
        const folder = uri("a", "b", "c");

        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, manager: "swiftly" },
            {
                type: "checkpoint",
                check() {
                    expect([...fileSystemWatchers.keys()]).to.have.members([
                        folder.fsPath,
                        uri("a", "b").fsPath,
                        uri("a").fsPath,
                        uri().fsPath,
                    ]);
                },
            },
            { type: "configurationChanged", setting: "maxSwiftVersionFileWatchDepth", value: 1 },
            {
                type: "checkpoint",
                check() {
                    // The directories that are no longer within the limit have been unwatched
                    expect([...fileSystemWatchers.keys()]).to.have.members([folder.fsPath]);
                },
            },
            // The parent is no longer watched, so its .swift-version file is ignored
            { type: "swiftVersionFileChanged", directory: parentOf(folder), version: "6.3" },
            {
                type: "checkpoint",
                check() {
                    expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.not.have.been
                        .called;
                },
            },
            // The folder itself is still watched at the new depth
            { type: "swiftVersionFileChanged", directory: folder, version: "6.4" },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.have.been.calledOnce;
    });

    test("starts watching folders when ignoreSwiftVersionFile is turned off", async () => {
        const folder = uri("1");
        mockSwiftConfig.get.withArgs("ignoreSwiftVersionFile").returns(true);

        await run([
            { type: "workspaceContextChanged", version: "6.2", manager: "swiftly" },
            { type: "addFolder", folder, version: "6.2", manager: "swiftly" },
            {
                type: "checkpoint",
                check() {
                    expect(fileSystemWatchers.size).to.equal(0);
                },
            },
            { type: "configurationChanged", setting: "ignoreSwiftVersionFile", value: false },
            {
                type: "checkpoint",
                check() {
                    expect([...fileSystemWatchers.keys()]).to.include(folder.fsPath);
                },
            },
            { type: "swiftVersionFileChanged", directory: folder, version: "6.3" },
        ]);

        expect(addedFolders.get(folder.fsPath)?.reloadToolchain).to.have.been.calledOnce;
    });
});
