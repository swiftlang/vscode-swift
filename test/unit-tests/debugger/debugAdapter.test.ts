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
import * as vscode from "vscode";
import * as mockFS from "mock-fs";
import { DebugAdapter } from "../../../src/debugger/debugAdapter";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";
import { Version } from "../../../src/utilities/version";
import { fn, mockNamespace, MockedObject, mockObject } from "../MockUtils2";

suite("verifyDebugAdapterExists false return Tests", () => {
    const mockedWindow = mockNamespace(vscode, "window");

    let mockWorkspaceContext: MockedObject<WorkspaceContext>;
    let mockToolchain: MockedObject<SwiftToolchain>;
    let mockOutputChannel: MockedObject<SwiftOutputChannel>;

    setup(() => {
        // Mock the file system
        mockFS();
        // Mock the WorkspaceContext and related dependencies
        const swiftVersion = new Version(5, 3, 0); // Any version
        mockToolchain = mockObject<SwiftToolchain>({
            swiftVersion,
            getLLDBDebugAdapter: fn(),
            getToolchainExecutable: fn(),
        });
        mockOutputChannel = mockObject<SwiftOutputChannel>({
            log: fn(),
        });
        mockWorkspaceContext = mockObject<WorkspaceContext>({
            toolchain: mockToolchain,
            swiftVersion,
            outputChannel: mockOutputChannel,
        });
    });

    teardown(() => {
        mockFS.restore();
    });

    test("should return false regardless of quiet setting", async () => {
        // Test with quiet = true
        await expect(
            DebugAdapter.verifyDebugAdapterExists(mockWorkspaceContext, true)
        ).to.eventually.equal(false, "Should return false when quiet is true");

        // Test with quiet = false
        await expect(
            DebugAdapter.verifyDebugAdapterExists(mockWorkspaceContext, false)
        ).to.eventually.equal(false, "Should return false when quiet is false");
    });

    test("should call showErrorMessage when quiet is false", async () => {
        await DebugAdapter.verifyDebugAdapterExists(mockWorkspaceContext, false);
        expect(mockedWindow.showErrorMessage).to.have.been.called;
    });

    test("should not call showErrorMessage when quiet is true", async () => {
        await DebugAdapter.verifyDebugAdapterExists(mockWorkspaceContext, true);
        expect(mockedWindow.showErrorMessage).to.not.have.been.called;
    });
});
