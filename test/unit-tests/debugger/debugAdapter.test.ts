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
import { expect } from "chai";
import {
    mockFileSystem,
    mockGlobalObject,
    MockedObject,
    mockObject,
    instance,
    mockGlobalModule,
    mockFn,
} from "../../MockUtils";
import configuration from "../../../src/configuration";
import { DebugAdapter, LaunchConfigType } from "../../../src/debugger/debugAdapter";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";
import { Version } from "../../../src/utilities/version";
import contextKeys from "../../../src/contextKeys";

suite("DebugAdapter Unit Test Suite", () => {
    const mockFS = mockFileSystem();
    const mockConfiguration = mockGlobalModule(configuration);
    const mockedContextKeys = mockGlobalModule(contextKeys);
    const mockedWindow = mockGlobalObject(vscode, "window");

    let mockDebugConfig: MockedObject<(typeof configuration)["debugger"]>;
    let mockWorkspaceContext: MockedObject<WorkspaceContext>;
    let mockToolchain: MockedObject<SwiftToolchain>;
    let mockOutputChannel: MockedObject<SwiftOutputChannel>;

    setup(() => {
        // Mock VS Code settings
        mockDebugConfig = mockObject<(typeof configuration)["debugger"]>({
            useDebugAdapterFromToolchain: false,
            customDebugAdapterPath: "",
        });
        mockConfiguration.debugger = instance(mockDebugConfig);
        // Mock the WorkspaceContext and related dependencies
        const toolchainPath = "/toolchains/swift";
        mockToolchain = mockObject<SwiftToolchain>({
            swiftVersion: new Version(6, 0, 0),
            getLLDBDebugAdapter: mockFn(s => s.callsFake(() => toolchainPath + "/lldb-dap")),
            getLLDB: mockFn(s => s.callsFake(() => toolchainPath + "/lldb")),
        });
        mockOutputChannel = mockObject<SwiftOutputChannel>({
            log: mockFn(),
        });
        mockWorkspaceContext = mockObject<WorkspaceContext>({
            toolchain: instance(mockToolchain),
            outputChannel: instance(mockOutputChannel),
            get swiftVersion() {
                return mockToolchain.swiftVersion;
            },
            set swiftVersion(version) {
                mockToolchain.swiftVersion = version;
            },
        });
    });

    suite("getLaunchConfigType()", () => {
        test("returns SWIFT_EXTENSION when Swift version >=6.0.0 and swift.debugger.useDebugAdapterFromToolchain is true", () => {
            mockDebugConfig.useDebugAdapterFromToolchain = true;
            expect(DebugAdapter.getLaunchConfigType(new Version(6, 0, 1))).to.equal(
                LaunchConfigType.SWIFT_EXTENSION
            );
        });

        test("returns CODE_LLDB when Swift version >=6.0.0 and swift.debugger.useDebugAdapterFromToolchain is false", () => {
            mockDebugConfig.useDebugAdapterFromToolchain = false;
            expect(DebugAdapter.getLaunchConfigType(new Version(6, 0, 1))).to.equal(
                LaunchConfigType.CODE_LLDB
            );
        });

        test("returns CODE_LLDB when Swift version is older than 6.0.0 regardless of setting", () => {
            // Try with the setting false
            mockDebugConfig.useDebugAdapterFromToolchain = false;
            expect(DebugAdapter.getLaunchConfigType(new Version(5, 10, 0))).to.equal(
                LaunchConfigType.CODE_LLDB
            );
            // Try with the setting true
            mockDebugConfig.useDebugAdapterFromToolchain = true;
            expect(DebugAdapter.getLaunchConfigType(new Version(5, 10, 0))).to.equal(
                LaunchConfigType.CODE_LLDB
            );
        });
    });

    suite("verifyDebugAdapterExists()", () => {
        suite("Using lldb-dap", () => {
            setup(() => {
                mockToolchain.swiftVersion = new Version(6, 0, 0);
                mockDebugConfig.useDebugAdapterFromToolchain = true;
                // Should be using lldb-dap in this case
                mockFS({
                    "/toolchains/swift/lldb-dap": mockFS.file({ content: "", mode: 0o770 }),
                });
            });

            createCommonTests();

            test("returns false when the toolchain throws an error trying to find lldb-dap", async () => {
                mockToolchain.getLLDBDebugAdapter.rejects(new Error("Uh oh!"));

                await expect(
                    DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), false)
                ).to.eventually.be.false;
            });

            test("shows an error message to the user when the toolchain throws an error trying to find lldb-dap", async () => {
                mockToolchain.getLLDBDebugAdapter.rejects(new Error("Uh oh!"));

                await DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), false);
                expect(mockedWindow.showErrorMessage).to.have.been.calledOnce;
            });

            test("disables the swift.lldbVSCodeAvailable context key if the toolchain throws an error trying to find lldb-dap", async () => {
                mockToolchain.getLLDBDebugAdapter.rejects(new Error("Uh oh!"));

                await DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), false);
                expect(mockedContextKeys.lldbVSCodeAvailable).to.be.false;
            });
        });

        suite("Using lldb-dap with custom debug adapter path", () => {
            setup(() => {
                mockToolchain.swiftVersion = new Version(6, 0, 0);
                mockDebugConfig.useDebugAdapterFromToolchain = true;
                mockDebugConfig.customDebugAdapterPath = "/path/to/custom/lldb-dap";
                // Should be using a custom lldb-dap in this case
                mockFS({
                    "/path/to/custom/lldb-dap": mockFS.file({ content: "", mode: 0o770 }),
                });
            });

            createCommonTests();
        });

        suite("Using CodeLLDB", () => {
            setup(() => {
                mockToolchain.swiftVersion = new Version(6, 0, 0);
                mockDebugConfig.useDebugAdapterFromToolchain = false;
                // Should be using CodeLLDB in this case
                mockFS({
                    "/toolchains/swift/lldb": mockFS.file({ content: "", mode: 0o770 }),
                });
            });

            createCommonTests();

            test("returns false when the toolchain throws an error trying to find lldb", async () => {
                mockToolchain.getLLDB.rejects(new Error("Uh oh!"));

                await expect(
                    DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), false)
                ).to.eventually.be.false;
            });

            test("shows an error message to the user when the toolchain throws an error trying to find lldb", async () => {
                mockToolchain.getLLDB.rejects(new Error("Uh oh!"));

                await DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), false);
                expect(mockedWindow.showErrorMessage).to.have.been.calledOnce;
            });

            test("disables the swift.lldbVSCodeAvailable context key if the toolchain throws an error trying to find lldb", async () => {
                mockToolchain.getLLDB.rejects(new Error("Uh oh!"));

                await DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), false);
                expect(mockedContextKeys.lldbVSCodeAvailable).to.be.false;
            });
        });

        function createCommonTests() {
            test("returns true when debug adapter exists regardless of quiet setting", async () => {
                // Test with quiet = true
                await expect(
                    DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), true)
                ).to.eventually.be.true;

                // Test with quiet = false
                await expect(
                    DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), false)
                ).to.eventually.be.true;
            });

            test("returns false when debug adapter doesn't exist regardless of quiet setting", async () => {
                // Reset the file system to empty
                mockFS({});

                // Test with quiet = true
                await expect(
                    DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), true)
                ).to.eventually.be.false;

                // Test with quiet = false
                await expect(
                    DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), false)
                ).to.eventually.be.false;
            });

            test("shows an error message to the user when the debug adapter doesn't exist and quiet is false", async () => {
                // Reset the file system to empty
                mockFS({});

                await DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), false);
                expect(mockedWindow.showErrorMessage).to.have.been.called;
            });

            test("doesn't show an error message to the user when the debug adapter doesn't exist and quiet is false", async () => {
                // Reset the file system to empty
                mockFS({});

                await DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), true);
                expect(mockedWindow.showErrorMessage).to.not.have.been.called;
            });

            test("doesn't show an error message to the user when the debug adapter exists", async () => {
                await DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext), true);
                expect(mockedWindow.showErrorMessage).to.not.have.been.called;
            });

            test("enables the swift.lldbVSCodeAvailable context key if the debugger exists", async () => {
                await DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext));
                expect(mockedContextKeys.lldbVSCodeAvailable).to.be.true;
            });

            test("disables the swift.lldbVSCodeAvailable context key if the debugger doesn't exist", async () => {
                // Reset the file system to empty
                mockFS({});

                await DebugAdapter.verifyDebugAdapterExists(instance(mockWorkspaceContext));
                expect(mockedContextKeys.lldbVSCodeAvailable).to.be.false;
            });
        }
    });
});
