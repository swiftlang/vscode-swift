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
import * as sinon from "sinon";

import { FolderContext } from "@src/FolderContext";
import { PackageWatcher } from "@src/PackageWatcher";
import { SwiftPackage } from "@src/SwiftPackage";
import { FolderOperation } from "@src/WorkspaceContext";
import { SwiftLogger } from "@src/logging/SwiftLogger";

import { MockedObject, instance, mockFn, mockObject } from "../MockUtils";

suite("PackageWatcher Suite", () => {
    let clock: sinon.SinonFakeTimers;
    let watcher: PackageWatcher;
    let folderContext: MockedObject<FolderContext>;
    let swiftPackage: MockedObject<SwiftPackage>;

    function createMockFolderContext() {
        const pkg = mockObject<SwiftPackage>({
            resolved: { fileHash: 123 } as any,
        });
        const fc = mockObject<FolderContext>({
            reload: mockFn(s => s.resolves()),
            fireEvent: mockFn(s => s.resolves()),
            reloadPackageResolved: mockFn(s => s.resolves()),
            swiftPackage: instance(pkg),
        });
        return { folderContext: fc, swiftPackage: pkg };
    }

    setup(() => {
        clock = sinon.useFakeTimers();
        const mocks = createMockFolderContext();
        folderContext = mocks.folderContext;
        swiftPackage = mocks.swiftPackage;
        const logger = mockObject<SwiftLogger>({});
        watcher = new PackageWatcher(instance(folderContext), instance(logger));
    });

    teardown(() => {
        watcher.dispose();
        clock.restore();
    });

    suite("handlePackageSwiftChange", () => {
        test("executes after 500ms", async () => {
            void watcher.handlePackageSwiftChange();

            expect(folderContext.reload).to.not.have.been.called;

            await clock.tickAsync(500);

            expect(folderContext.reload).to.have.been.calledOnce;
            expect(folderContext.fireEvent).to.have.been.calledOnceWith(
                FolderOperation.packageUpdated
            );
        });

        test("resets timer on rapid calls", async () => {
            void watcher.handlePackageSwiftChange();
            await clock.tickAsync(200);
            void watcher.handlePackageSwiftChange();
            await clock.tickAsync(200);
            void watcher.handlePackageSwiftChange();

            expect(folderContext.reload).to.not.have.been.called;

            await clock.tickAsync(500);

            expect(folderContext.reload).to.have.been.calledOnce;
        });

        test("does not execute if disposed before timeout", async () => {
            void watcher.handlePackageSwiftChange();
            await clock.tickAsync(200);

            watcher.dispose();
            await clock.tickAsync(500);

            expect(folderContext.reload).to.not.have.been.called;
        });
    });

    suite("handlePackageResolvedChange", () => {
        test("executes after 500ms", async () => {
            void watcher.handlePackageResolvedChange();

            expect(folderContext.reloadPackageResolved).to.not.have.been.called;

            await clock.tickAsync(500);

            expect(folderContext.reloadPackageResolved).to.have.been.calledOnce;
        });

        test("resets timer on rapid calls", async () => {
            void watcher.handlePackageResolvedChange();
            await clock.tickAsync(200);
            void watcher.handlePackageResolvedChange();
            await clock.tickAsync(200);
            void watcher.handlePackageResolvedChange();

            expect(folderContext.reloadPackageResolved).to.not.have.been.called;

            await clock.tickAsync(500);

            expect(folderContext.reloadPackageResolved).to.have.been.calledOnce;
        });

        test("does not execute if disposed before timeout", async () => {
            void watcher.handlePackageResolvedChange();
            await clock.tickAsync(200);

            watcher.dispose();
            await clock.tickAsync(500);

            expect(folderContext.reloadPackageResolved).to.not.have.been.called;
        });

        test("fires resolvedUpdated when hash changes", async () => {
            folderContext.reloadPackageResolved.callsFake(async () => {
                swiftPackage.resolved = { fileHash: 456 } as any;
            });

            void watcher.handlePackageResolvedChange();
            await clock.tickAsync(500);

            expect(folderContext.fireEvent).to.have.been.calledOnceWith(
                FolderOperation.resolvedUpdated
            );
        });

        test("does not fire resolvedUpdated when hash is unchanged", async () => {
            // reloadPackageResolved keeps hash at 123 (default mock behavior)
            void watcher.handlePackageResolvedChange();
            await clock.tickAsync(500);

            expect(folderContext.fireEvent).to.not.have.been.called;
        });

        test("suppresses resolvedUpdated on hash oscillation", async () => {
            // Round 1: hash changes 123 → 456
            folderContext.reloadPackageResolved.callsFake(async () => {
                swiftPackage.resolved = { fileHash: 456 } as any;
            });
            void watcher.handlePackageResolvedChange();
            await clock.tickAsync(500);
            expect(folderContext.fireEvent).to.have.been.calledOnceWith(
                FolderOperation.resolvedUpdated
            );

            // Round 2: hash changes 456 → 123 (e.g. reverted by background indexing)
            folderContext.fireEvent.resetHistory();
            folderContext.reloadPackageResolved.callsFake(async () => {
                swiftPackage.resolved = { fileHash: 123 } as any;
            });
            void watcher.handlePackageResolvedChange();
            await clock.tickAsync(500);
            expect(folderContext.fireEvent).to.have.been.calledOnceWith(
                FolderOperation.resolvedUpdated
            );

            // Round 3: hash changes back to 456 (oscillation detected)
            folderContext.fireEvent.resetHistory();
            folderContext.reloadPackageResolved.callsFake(async () => {
                swiftPackage.resolved = { fileHash: 456 } as any;
            });
            void watcher.handlePackageResolvedChange();
            await clock.tickAsync(500);
            expect(folderContext.fireEvent).to.not.have.been.called;
        });

        test("resets oscillation detection after quiet period", async () => {
            // Round 1: hash changes 123 → 456
            folderContext.reloadPackageResolved.callsFake(async () => {
                swiftPackage.resolved = { fileHash: 456 } as any;
            });
            void watcher.handlePackageResolvedChange();
            await clock.tickAsync(500);
            expect(folderContext.fireEvent).to.have.been.calledOnce;

            // Wait for the 5-second cooldown to clear hash history
            folderContext.fireEvent.resetHistory();
            await clock.tickAsync(5000);

            // Round 2: hash changes 456 → 123, should fire (history cleared)
            folderContext.reloadPackageResolved.callsFake(async () => {
                swiftPackage.resolved = { fileHash: 123 } as any;
            });
            void watcher.handlePackageResolvedChange();
            await clock.tickAsync(500);
            expect(folderContext.fireEvent).to.have.been.calledOnce;

            // Wait for cooldown again
            folderContext.fireEvent.resetHistory();
            await clock.tickAsync(5000);

            // Round 3: hash changes back to 456, should also fire (history cleared)
            folderContext.reloadPackageResolved.callsFake(async () => {
                swiftPackage.resolved = { fileHash: 456 } as any;
            });
            void watcher.handlePackageResolvedChange();
            await clock.tickAsync(500);
            expect(folderContext.fireEvent).to.have.been.calledOnce;
        });
    });
});
