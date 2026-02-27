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

import { instance, mockFn, mockObject } from "../MockUtils";

suite("PackageWatcher Suite", () => {
    let clock: sinon.SinonFakeTimers;
    let watcher: PackageWatcher;
    let folderContext: ReturnType<typeof createMockFolderContext>;

    function createMockFolderContext() {
        const swiftPackage = mockObject<SwiftPackage>({
            resolved: { fileHash: 123 } as any,
        });
        return mockObject<FolderContext>({
            reload: mockFn(s => s.resolves()),
            fireEvent: mockFn(s => s.resolves()),
            reloadPackageResolved: mockFn(s => s.resolves()),
            swiftPackage: instance(swiftPackage),
        });
    }

    setup(() => {
        clock = sinon.useFakeTimers();
        folderContext = createMockFolderContext();
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
    });
});
