//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as assert from "assert";
import { afterEach } from "mocha";
import { restore, stub } from "sinon";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import * as toolchain from "@src/ui/ToolchainSelection";

import { MockedFunction, mockGlobalValue } from "../MockUtils";
import { testAssetUri } from "../fixtures";
import { activateExtensionForSuite, getRootWorkspaceFolder } from "./utilities/testutilities";

suite("FolderContext Error Handling Test Suite", () => {
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext | undefined;
    let swiftToolchainCreateStub: MockedFunction<typeof SwiftToolchain.create>;
    const showToolchainError = mockGlobalValue(toolchain, "showToolchainError");

    activateExtensionForSuite({
        async setup(ctx) {
            workspaceContext = ctx;
            this.timeout(60000);
        },
        testAssets: ["defaultPackage"],
    });

    afterEach(() => {
        folderContext?.dispose();
        restore();
    });

    test("handles SwiftToolchain.create failure gracefully with user dismissal", async () => {
        const mockError = new Error("Mock toolchain failure");
        swiftToolchainCreateStub = stub(SwiftToolchain, "create").throws(mockError);

        // Mock showToolchainError to return false (user dismissed dialog)
        const showToolchainErrorStub = stub().resolves(false);
        showToolchainError.setValue(showToolchainErrorStub);

        const workspaceFolder = getRootWorkspaceFolder();
        const testFolder = testAssetUri("package2");

        folderContext = await FolderContext.create(testFolder, workspaceFolder, workspaceContext);

        assert.ok(folderContext, "FolderContext should be created despite toolchain failure");
        assert.strictEqual(
            folderContext.toolchain,
            workspaceContext.globalToolchain,
            "Should fallback to global toolchain when user dismisses dialog"
        );

        const errorLogs = workspaceContext.logger.logs.filter(
            log =>
                log.includes("Failed to discover Swift toolchain") &&
                log.includes("package2") &&
                log.includes("Mock toolchain failure")
        );
        assert.ok(errorLogs.length > 0, "Should log error message with folder context");

        assert.ok(
            swiftToolchainCreateStub.calledWith(
                workspaceContext.extensionContext.extensionPath,
                testFolder
            ),
            "Should attempt to create toolchain for specific folder"
        );
        assert.strictEqual(
            swiftToolchainCreateStub.callCount,
            1,
            "Should only call SwiftToolchain.create once when user dismisses"
        );
    });

    test("retries toolchain creation when user makes selection and succeeds", async () => {
        const workspaceFolder = getRootWorkspaceFolder();
        const testFolder = testAssetUri("package2");

        // Arrange: Mock SwiftToolchain.create to fail first time, succeed second time
        swiftToolchainCreateStub = stub(SwiftToolchain, "create");
        swiftToolchainCreateStub.onFirstCall().throws(new Error("Initial toolchain failure"));
        swiftToolchainCreateStub
            .onSecondCall()
            .returns(Promise.resolve(workspaceContext.globalToolchain));

        // Mock showToolchainError to return true (user made selection)
        const showToolchainErrorStub = stub().resolves(true);
        showToolchainError.setValue(showToolchainErrorStub);

        folderContext = await FolderContext.create(testFolder, workspaceFolder, workspaceContext);

        // Assert: FolderContext should be created successfully
        assert.ok(folderContext, "FolderContext should be created after retry");
        assert.strictEqual(
            folderContext.toolchain,
            workspaceContext.globalToolchain,
            "Should use successfully created toolchain after retry"
        );

        // Assert: SwiftToolchain.create should be called twice (initial + retry)
        assert.strictEqual(
            swiftToolchainCreateStub.callCount,
            2,
            "Should retry toolchain creation after user selection"
        );

        // Assert: Should log both failure and success
        const failureLogs = workspaceContext.logger.logs.filter(log =>
            log.includes("Failed to discover Swift toolchain for package2")
        );
        const successLogs = workspaceContext.logger.logs.filter(log =>
            log.includes("Successfully created toolchain for package2 after user selection")
        );

        assert.ok(failureLogs.length > 0, "Should log initial failure");
        assert.ok(successLogs.length > 0, "Should log success after retry");
    });

    test("retries toolchain creation when user makes selection but still fails", async () => {
        const workspaceFolder = getRootWorkspaceFolder();
        const testFolder = testAssetUri("package2");

        const initialError = new Error("Initial toolchain failure");
        const retryError = new Error("Retry toolchain failure");
        swiftToolchainCreateStub = stub(SwiftToolchain, "create");
        swiftToolchainCreateStub.onFirstCall().throws(initialError);
        swiftToolchainCreateStub.onSecondCall().throws(retryError);

        // Mock showToolchainError to return true (user made selection)
        const showToolchainErrorStub = stub().resolves(true);
        showToolchainError.setValue(showToolchainErrorStub);

        folderContext = await FolderContext.create(testFolder, workspaceFolder, workspaceContext);

        assert.ok(
            folderContext,
            "FolderContext should be created with fallback after retry failure"
        );
        assert.strictEqual(
            folderContext.toolchain,
            workspaceContext.globalToolchain,
            "Should fallback to global toolchain when retry also fails"
        );

        assert.strictEqual(
            swiftToolchainCreateStub.callCount,
            2,
            "Should retry toolchain creation after user selection"
        );

        const initialFailureLogs = workspaceContext.logger.logs.filter(log =>
            log.includes(
                "Failed to discover Swift toolchain for package2: Error: Initial toolchain failure"
            )
        );
        const retryFailureLogs = workspaceContext.logger.logs.filter(log =>
            log.includes(
                "Failed to create toolchain for package2 even after user selection: Error: Retry toolchain failure"
            )
        );

        assert.ok(initialFailureLogs.length > 0, "Should log initial failure");
        assert.ok(retryFailureLogs.length > 0, "Should log retry failure");
    });
});
