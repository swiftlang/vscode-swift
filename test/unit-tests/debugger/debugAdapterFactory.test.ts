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
    LLDBDebugAdapterExecutableFactory,
    LLDBDebugConfigurationProvider,
} from "../../../src/debugger/debugAdapterFactory";
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
import {
    DebugAdapter,
    LaunchConfigType,
    SWIFT_LAUNCH_CONFIG_TYPE,
} from "../../../src/debugger/debugAdapter";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";

suite("LLDBDebugAdapterExecutableFactory Tests", () => {
    const mockAdapter = mockGlobalModule(DebugAdapter);
    let mockToolchain: MockedObject<SwiftToolchain>;
    let mockOutputChannel: MockedObject<SwiftOutputChannel>;

    setup(() => {
        mockToolchain = mockObject<SwiftToolchain>({});
        mockOutputChannel = mockObject<SwiftOutputChannel>({
            log: mockFn(),
        });
    });

    test("should return DebugAdapterExecutable when path and verification succeed", async () => {
        const toolchainPath = "/path/to/debug/adapter";

        mockAdapter.debugAdapterPath.resolves(toolchainPath);
        mockAdapter.verifyDebugAdapterExists.resolves(true);

        const factory = new LLDBDebugAdapterExecutableFactory(
            instance(mockToolchain),
            instance(mockOutputChannel)
        );
        const result = await factory.createDebugAdapterDescriptor();

        expect(result).to.be.instanceOf(vscode.DebugAdapterExecutable);
        expect((result as vscode.DebugAdapterExecutable).command).to.equal(toolchainPath);

        expect(mockAdapter.debugAdapterPath).to.have.been.calledOnce;
        expect(mockAdapter.verifyDebugAdapterExists).to.have.been.calledOnce;
    });

    test("should throw error if debugAdapterPath fails", async () => {
        const errorMessage = "Failed to get debug adapter path";

        mockAdapter.debugAdapterPath.rejects(new Error(errorMessage));

        const factory = new LLDBDebugAdapterExecutableFactory(
            instance(mockToolchain),
            instance(mockOutputChannel)
        );

        await expect(factory.createDebugAdapterDescriptor()).to.eventually.be.rejectedWith(
            Error,
            errorMessage
        );

        expect(mockAdapter.debugAdapterPath).to.have.been.calledOnce;
        expect(mockAdapter.verifyDebugAdapterExists).to.not.have.been.called;
    });

    test("should throw error if verifyDebugAdapterExists fails", async () => {
        const toolchainPath = "/path/to/debug/adapter";
        const errorMessage = "Failed to verify debug adapter exists";

        mockAdapter.debugAdapterPath.resolves(toolchainPath);
        mockAdapter.verifyDebugAdapterExists.rejects(new Error(errorMessage));

        const factory = new LLDBDebugAdapterExecutableFactory(
            instance(mockToolchain),
            instance(mockOutputChannel)
        );

        await expect(factory.createDebugAdapterDescriptor()).to.eventually.be.rejectedWith(
            Error,
            errorMessage
        );

        expect(mockAdapter.debugAdapterPath).to.have.been.calledOnce;
        expect(mockAdapter.verifyDebugAdapterExists).to.have.been.calledOnce;
    });
});

suite("LLDBDebugConfigurationProvider Tests", () => {
    let swift6Toolchain: SwiftToolchain;
    let swift5Toolchain: SwiftToolchain;
    const mockDebugConfig = mockGlobalObject(configuration, "debugger");

    setup(() => {
        mockDebugConfig.debugAdapter = "auto";
        swift6Toolchain = instance(
            mockObject<SwiftToolchain>({
                swiftVersion: new Version(6, 0, 0),
            })
        );
        swift5Toolchain = instance(
            mockObject<SwiftToolchain>({
                swiftVersion: new Version(5, 10, 0),
            })
        );
    });

    test("delegates to CodeLLDB when debugAdapter is set to auto", async () => {
        mockDebugConfig.debugAdapter = "auto";
        const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6Toolchain);
        const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
            name: "Test Launch Config",
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            program: "${workspaceFolder}/.build/debug/executable",
        });
        expect(launchConfig).to.containSubset({ type: LaunchConfigType.CODE_LLDB });
    });

    test("delegates to lldb-dap when debugAdapter is set to lldb-dap and swift version >=6.0.0", async () => {
        mockDebugConfig.debugAdapter = "lldb-dap";
        const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6Toolchain);
        const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
            name: "Test Launch Config",
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            program: "${workspaceFolder}/.build/debug/executable",
        });
        expect(launchConfig).to.containSubset({ type: LaunchConfigType.LLDB_DAP });
    });

    test("delegates to CodeLLDB even though debugAdapter is set to lldb-dap and swift version >=6.0.0", async () => {
        mockDebugConfig.debugAdapter = "lldb-dap";
        const configProvider = new LLDBDebugConfigurationProvider("darwin", swift5Toolchain);
        const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
            name: "Test Launch Config",
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            program: "${workspaceFolder}/.build/debug/executable",
        });
        expect(launchConfig).to.containSubset({
            type: LaunchConfigType.CODE_LLDB,
            sourceLanguages: ["swift"],
        });
    });

    test("modifies program to add file extension on Windows", async () => {
        const configProvider = new LLDBDebugConfigurationProvider("win32", swift6Toolchain);
        const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
            name: "Test Launch Config",
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            program: "${workspaceFolder}/.build/debug/executable",
        });
        expect(launchConfig).to.containSubset({
            program: "${workspaceFolder}/.build/debug/executable.exe",
        });
    });

    test("does not modify program on Windows if file extension is already present", async () => {
        const configProvider = new LLDBDebugConfigurationProvider("win32", swift6Toolchain);
        const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
            name: "Test Launch Config",
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            program: "${workspaceFolder}/.build/debug/executable.exe",
        });
        expect(launchConfig).to.containSubset({
            program: "${workspaceFolder}/.build/debug/executable.exe",
        });
    });

    test("does not modify program on macOS", async () => {
        const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6Toolchain);
        const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
            name: "Test Launch Config",
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            program: "${workspaceFolder}/.build/debug/executable",
        });
        expect(launchConfig).to.containSubset({
            program: "${workspaceFolder}/.build/debug/executable",
        });
    });

    test("does not modify program on Linux", async () => {
        const configProvider = new LLDBDebugConfigurationProvider("linux", swift6Toolchain);
        const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
            name: "Test Launch Config",
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            program: "${workspaceFolder}/.build/debug/executable",
        });
        expect(launchConfig).to.containSubset({
            program: "${workspaceFolder}/.build/debug/executable",
        });
    });

    test("should convert environment variables to string[] format when using lldb-dap", async () => {
        mockDebugConfig.debugAdapter = "lldb-dap";
        const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6Toolchain);
        const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
            name: "Test Launch Config",
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            program: "${workspaceFolder}/.build/debug/executable",
            env: {
                VAR1: "value1",
                VAR2: "value2",
            },
        });
        expect(launchConfig)
            .to.have.property("env")
            .that.deep.equals(["VAR1=value1", "VAR2=value2"]);
    });

    test("should leave env undefined when environment variables are undefined and using lldb-dap", async () => {
        mockDebugConfig.debugAdapter = "lldb-dap";
        const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6Toolchain);
        const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
            name: "Test Launch Config",
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            program: "${workspaceFolder}/.build/debug/executable",
        });
        expect(launchConfig).to.not.have.property("env");
    });

    test("should convert empty environment variables when using lldb-dap", async () => {
        mockDebugConfig.debugAdapter = "lldb-dap";
        const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6Toolchain);
        const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            name: "Test Launch",
            env: {},
        });

        expect(launchConfig).to.have.property("env").that.deep.equals([]);
    });

    test("should handle a large number of environment variables when using lldb-dap", async () => {
        mockDebugConfig.debugAdapter = "lldb-dap";
        // Create 1000 environment variables
        const env: { [key: string]: string } = {};
        for (let i = 0; i < 1000; i++) {
            env[`VAR${i}`] = `value${i}`;
        }
        const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6Toolchain);
        const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "launch",
            name: "Test Launch",
            env,
        });

        // Verify that all 1000 environment variables are properly converted
        const expectedEnv = Array.from({ length: 1000 }, (_, i) => `VAR${i}=value${i}`);
        expect(launchConfig).to.have.property("env").that.deep.equals(expectedEnv);
    });
});
