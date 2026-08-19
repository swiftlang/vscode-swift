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

import { ContextKeys } from "@src/ContextKeyManager";
import { FolderContext } from "@src/FolderContext";
import { FileOperation } from "@src/SwiftExtensionApi";
import {
    FolderEvent,
    FolderOperation,
    SwiftFileEvent,
    WorkspaceContext,
} from "@src/WorkspaceContext";
import { SwiftLoggerFactory } from "@src/logging/SwiftLoggerFactory";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Disposable } from "@src/utilities/Disposable";
import { Version } from "@src/utilities/version";

import { MockedObject, instance, mockFn, mockObject } from "../MockUtils";
import { TestLogger } from "../utilities/TestLogger";

suite("WorkspaceContext Unit Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let contextKeys: MockedObject<ContextKeys>;
    let subscriptions: Disposable[];

    /**
     * Collects the events it receives, along with the `this` value that each
     * listener call was made with. Listeners are deliberately unbound methods
     * so that tests can check that `thisArg` is applied by the event.
     */
    class EventCollector<T> {
        readonly events: { event: T; thisArg: unknown }[] = [];

        collect(this: EventCollector<T>, event: T) {
            this.events.push({ event, thisArg: this });
        }
    }

    function createMockFolderContext(name: string): FolderContext {
        return instance(
            mockObject<FolderContext>({
                name,
                folder: vscode.Uri.file(`/${name}`),
                dispose: mockFn(),
            })
        );
    }

    setup(() => {
        subscriptions = [];
        contextKeys = mockObject<ContextKeys>({
            hasPackage: false,
            hasExecutableProduct: false,
            packageHasDependencies: false,
            updateForFolder: mockFn(),
            updateForFile: mockFn(s => s.resolves()),
            updateForPlugins: mockFn(),
        });
        workspaceContext = new WorkspaceContext(
            instance(mockObject<vscode.ExtensionContext>({ subscriptions: [] })),
            instance(contextKeys),
            instance(mockObject<vscode.OutputChannel>({ show: mockFn() })),
            instance(mockObject<SwiftLoggerFactory>({})),
            new TestLogger(),
            instance(mockObject<SwiftToolchain>({ swiftVersion: new Version(6, 2, 0) }))
        );
    });

    teardown(async () => {
        subscriptions.forEach(subscription => subscription.dispose());
        await workspaceContext.dispose();
    });

    suite("onDidChangeFolders", () => {
        test("notifies listeners of folder events", async () => {
            const collector = new EventCollector<FolderEvent>();
            subscriptions.push(workspaceContext.onDidChangeFolders(e => collector.collect(e)));

            await workspaceContext.fireEvent(null, FolderOperation.add);

            expect(collector.events.map(e => e.event)).to.deep.equal([
                { folder: null, operation: FolderOperation.add, workspace: workspaceContext },
            ]);
        });

        test("replays the current folders and focused folder to new listeners", () => {
            const folder = createMockFolderContext("folder1");
            workspaceContext.folders.push(folder);
            workspaceContext.currentFolder = folder;

            const collector = new EventCollector<FolderEvent>();
            subscriptions.push(workspaceContext.onDidChangeFolders(e => collector.collect(e)));

            expect(collector.events.map(e => e.event)).to.deep.equal([
                { folder, operation: FolderOperation.add, workspace: workspaceContext },
                { folder, operation: FolderOperation.focus, workspace: workspaceContext },
            ]);
        });

        test("calls the listener with the provided thisArg", async () => {
            const collector = new EventCollector<FolderEvent>();
            subscriptions.push(
                workspaceContext.onDidChangeFolders(collector.collect, collector, subscriptions)
            );

            await workspaceContext.fireEvent(null, FolderOperation.add);

            expect(collector.events).to.deep.equal([
                {
                    event: {
                        folder: null,
                        operation: FolderOperation.add,
                        workspace: workspaceContext,
                    },
                    thisArg: collector,
                },
            ]);
        });

        test("calls the listener with the provided thisArg for replayed events", () => {
            const folder = createMockFolderContext("folder1");
            workspaceContext.folders.push(folder);

            const collector = new EventCollector<FolderEvent>();
            subscriptions.push(workspaceContext.onDidChangeFolders(collector.collect, collector));

            expect(collector.events).to.deep.equal([
                {
                    event: { folder, operation: FolderOperation.add, workspace: workspaceContext },
                    thisArg: collector,
                },
            ]);
        });

        test("adds the returned disposable to the provided disposables array", () => {
            const disposables: Disposable[] = [];

            const disposable = workspaceContext.onDidChangeFolders(
                () => {},
                undefined,
                disposables
            );
            subscriptions.push(disposable);

            expect(disposables).to.deep.equal([disposable]);
        });

        test("stops notifying the listener once the subscription is disposed", async () => {
            const collector = new EventCollector<FolderEvent>();
            const disposable = workspaceContext.onDidChangeFolders(e => collector.collect(e));

            disposable.dispose();
            await workspaceContext.fireEvent(null, FolderOperation.add);

            expect(collector.events).to.be.empty;
        });

        test("stops notifying the listener once the subscription is disposed with a thisArg", async () => {
            const collector = new EventCollector<FolderEvent>();
            const disposable = workspaceContext.onDidChangeFolders(collector.collect, collector);

            disposable.dispose();
            await workspaceContext.fireEvent(null, FolderOperation.add);

            expect(collector.events).to.be.empty;
        });
    });

    suite("onDidChangeSwiftFiles", () => {
        const swiftFileEvent: SwiftFileEvent = {
            operation: FileOperation.changed,
            uri: vscode.Uri.file("/folder1/Sources/main.swift"),
        };

        test("notifies listeners of swift file events", () => {
            const collector = new EventCollector<SwiftFileEvent>();
            subscriptions.push(workspaceContext.onDidChangeSwiftFiles(e => collector.collect(e)));

            workspaceContext.fireSwiftFileChange(swiftFileEvent);

            expect(collector.events.map(c => c.event)).to.deep.equal([swiftFileEvent]);
        });

        test("calls the listener with the provided thisArg", () => {
            const collector = new EventCollector<SwiftFileEvent>();
            subscriptions.push(
                workspaceContext.onDidChangeSwiftFiles(collector.collect, collector, subscriptions)
            );

            workspaceContext.fireSwiftFileChange(swiftFileEvent);

            expect(collector.events).to.deep.equal([{ event: swiftFileEvent, thisArg: collector }]);
        });

        test("adds the returned disposable to the provided disposables array", () => {
            const disposables: Disposable[] = [];

            const disposable = workspaceContext.onDidChangeSwiftFiles(
                () => {},
                undefined,
                disposables
            );
            subscriptions.push(disposable);

            expect(disposables).to.deep.equal([disposable]);
        });

        test("stops notifying the listener once the subscription is disposed", () => {
            const collector = new EventCollector<SwiftFileEvent>();
            const disposable = workspaceContext.onDidChangeSwiftFiles(e => collector.collect(e));

            disposable.dispose();
            workspaceContext.fireSwiftFileChange(swiftFileEvent);

            expect(collector.events).to.be.empty;
        });

        test("stops notifying the listener once the subscription is disposed with a thisArg", () => {
            const collector = new EventCollector<SwiftFileEvent>();
            const disposable = workspaceContext.onDidChangeSwiftFiles(collector.collect, collector);

            disposable.dispose();
            workspaceContext.fireSwiftFileChange(swiftFileEvent);

            expect(collector.events).to.be.empty;
        });
    });
});
