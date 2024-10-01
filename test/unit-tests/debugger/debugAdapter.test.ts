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

import * as vscode from "vscode";
import * as fs from "fs/promises";
import { expect } from "chai";
import { DebugAdapter } from "../../../src/debugger/debugAdapter";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";
import { Version } from "../../../src/utilities/version";
import {
    mockGlobalObject,
    MockedObject,
    mockObject,
    instance,
    mockGlobalModule,
    mockFn,
} from "../../MockUtils";
import configuration from "../../../src/configuration";

suite("DebugAdapter Tests", () => {
    suite("customDebugAdapterPath take precedent", () => {
        const mockDebugConfig = mockGlobalObject(configuration, "debugger");

        test("customDebugAdapterPath take precedent", async () => {
            const mockToolchain = mockObject<SwiftToolchain>({});
            const mockContext = mockObject<WorkspaceContext>({
                toolchain: instance(mockToolchain),
            });
            const expectPath = "/something/cool-lldb";
            mockDebugConfig.customDebugAdapterPath = expectPath;

            const path = await DebugAdapter.debugAdapterPath(mockContext.toolchain);
            expect(path).to.deep.equal(expectPath);
        });

        // gap to be covered by integration test: lldb-dap darwin vs. non darwin
    });

    suite("verifyDebugAdapterExists false return Tests", () => {
        const mockedWindow = mockGlobalObject(vscode, "window");
        const mockedFS = mockGlobalModule(fs);

        let mockWorkspaceContext: MockedObject<WorkspaceContext>;
        let mockToolchain: MockedObject<SwiftToolchain>;
        let mockOutputChannel: MockedObject<SwiftOutputChannel>;

        setup(() => {
            // Mock the file system
            mockedFS.stat.throws(new Error("File does not exist"));
            // Mock the WorkspaceContext and related dependencies
            const swiftVersion = new Version(5, 3, 0); // Any version
            mockToolchain = mockObject<SwiftToolchain>({
                swiftVersion,
                getLLDBDebugAdapter: mockFn(),
                getToolchainExecutable: mockFn(),
            });
            mockOutputChannel = mockObject<SwiftOutputChannel>({
                log: mockFn(),
            });
            mockWorkspaceContext = mockObject<WorkspaceContext>({
                toolchain: instance(mockToolchain),
                swiftVersion,
                outputChannel: instance(mockOutputChannel),
            });
        });

        test("should return false regardless of quiet setting", async () => {
            await expect(
                DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), true)
            ).to.eventually.equal(false, "Should return false when quiet is true");

            await expect(
                DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), false)
            ).to.eventually.equal(false, "Should return false when quiet is false");
        });

        test("should call showErrorMessage when quiet is false", async () => {
            await DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), false);
            expect(mockedWindow.showErrorMessage).to.have.been.called;
        });

        test("should not call showErrorMessage when quiet is true", async () => {
            await DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), true);
            expect(mockedWindow.showErrorMessage).to.not.have.been.called;
        });

        // gap to be covered by integration test: true return of verifyDebugAdapterExists
    });
});
