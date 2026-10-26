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

import { FolderContext } from "@src/FolderContext";
import { SwiftPackage } from "@src/SwiftPackage";
import { TestExplorer } from "@src/TestExplorer/TestExplorer";
import { FolderEvent, FolderOperation, WorkspaceContext } from "@src/WorkspaceContext";
import { SourceKitLanguageClient } from "@src/sourcekit-lsp/client/SourceKitLanguageClient";
import { TaskManager } from "@src/tasks/TaskManager";
import { TaskQueue } from "@src/tasks/TaskQueue";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Disposable } from "@src/utilities/Disposable";
import { Version } from "@src/utilities/version";

import { instance, mockFn, mockObject } from "../../MockUtils";
import { TestLogger } from "../../utilities/TestLogger";

suite("TestExplorer", () => {
    let subscriptions: Disposable[];

    setup(() => {
        subscriptions = [];
    });

    teardown(() => {
        subscriptions.forEach(s => s.dispose());
    });

    test("Removing the folder during initial test discovery stops it listing tests", async () => {
        const logger = new TestLogger();
        const folderEvents = new vscode.EventEmitter<FolderEvent>();
        const workspaceContext = instance(
            mockObject<WorkspaceContext>({
                logger,
                onDidChangeFolders: mockFn(s => s.callsFake(folderEvents.event)),
                onDidFinishIndexing: mockFn(s =>
                    s.callsFake(new vscode.EventEmitter<void>().event)
                ),
            })
        );
        const taskQueue = mockObject<TaskQueue>({
            queueOperation: mockFn(s => s.resolves(undefined)),
        });
        const folder: FolderContext = instance(
            mockObject<FolderContext>({
                name: "removed-folder",
                folder: vscode.Uri.file("/removed-folder"),
                workspaceFolder: {
                    uri: vscode.Uri.file("/removed-folder"),
                    name: "removed-folder",
                    index: 0,
                },
                workspaceContext,
                logger,
                taskQueue: instance(taskQueue),
                toolchain: instance(
                    mockObject<SwiftToolchain>({
                        swiftVersion: new Version(6, 3, 0),
                        sanitizer: mockFn(),
                    })
                ),
                swiftPackage: instance(
                    mockObject<SwiftPackage>({
                        getTargets: mockFn(s => s.resolves([{ name: "Tests" }])),
                    })
                ),
                languageClient: instance(
                    mockObject<SourceKitLanguageClient>({
                        // Removing the folder disposes the language client mid-request
                        useLanguageClient: mockFn(s =>
                            s.callsFake(async () => {
                                folder.removeTestExplorer();
                                throw new Error("SourceKitLanguageClient has not yet been created");
                            })
                        ),
                    })
                ),
                hasTestExplorer: mockFn(s => s.returns(false)),
                addTestExplorer: mockFn(s =>
                    s.callsFake(() => {
                        testExplorer = new TestExplorer(
                            folder,
                            instance(
                                mockObject<TaskManager>({
                                    onDidEndTaskProcess: mockFn(s =>
                                        s.callsFake(new vscode.EventEmitter<never>().event)
                                    ),
                                })
                            ),
                            logger,
                            () => new Disposable(() => {})
                        );
                        return testExplorer;
                    })
                ),
                removeTestExplorer: mockFn(s => s.callsFake(() => testExplorer?.dispose())),
            })
        );
        let testExplorer: TestExplorer | undefined;
        subscriptions.push(folderEvents, TestExplorer.observeFolders(workspaceContext));

        folderEvents.fire({ operation: FolderOperation.add, workspace: workspaceContext, folder });
        await new Promise(r => setImmediate(r));

        expect(testExplorer, "test explorer was not created").to.not.be.undefined;
        expect(taskQueue.queueOperation).to.not.have.been.called;
    });
});
