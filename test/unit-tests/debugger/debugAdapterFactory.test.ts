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
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { DebugAdapter } from "../../../src/debugger/debugAdapter";
import {
    LLDBDebugAdapterExecutableFactory,
    LLDBDebugConfigurationProvider,
} from "../../../src/debugger/debugAdapterFactory";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { Version } from "../../../src/utilities/version";
import {
    mockGlobalObject,
    MockedObject,
    mockObject,
    instance,
    mockGlobalModule,
} from "../../MockUtils";
import configuration from "../../../src/configuration";

suite("Debug Adapter Factory Test Suite", () => {
    const swift6 = new Version(6, 0, 0);
    const swift510 = new Version(5, 10, 1);
    const mockDebugConfig = mockGlobalObject(configuration, "debugger");

    suite("LLDBDebugConfigurationProvider Test Suite", () => {
        setup(() => {
            mockDebugConfig.useDebugAdapterFromToolchain = true;
        });

        test("uses lldb-dap for swift versions >=6.0.0", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            expect(launchConfig).to.containSubset({ type: DebugAdapter.adapterName });
        });

        test("delegates to CodeLLDB for swift versions <6.0.0", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("darwin", swift510);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            expect(launchConfig).to.containSubset({
                type: "lldb",
                sourceLanguages: ["swift"],
            });
        });

        test("delegates to CodeLLDB on Swift 6.0.0 if setting swift.debugger.useDebugAdapterFromToolchain is explicitly disabled", async () => {
            mockDebugConfig.useDebugAdapterFromToolchain = false;
            const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            expect(launchConfig).to.containSubset({
                type: "lldb",
                sourceLanguages: ["swift"],
            });
        });

        test("modifies program to add file extension on Windows", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("win32", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            expect(launchConfig).to.containSubset({
                program: "${workspaceFolder}/.build/debug/executable.exe",
            });
        });

        test("does not modify program on Windows if file extension is already present", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("win32", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable.exe",
            });
            expect(launchConfig).to.containSubset({
                program: "${workspaceFolder}/.build/debug/executable.exe",
            });
        });

        test("does not modify program on macOS", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            expect(launchConfig).to.containSubset({
                program: "${workspaceFolder}/.build/debug/executable",
            });
        });

        test("does not modify program on Linux", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("linux", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            expect(launchConfig).to.containSubset({
                program: "${workspaceFolder}/.build/debug/executable",
            });
        });
    });
});

suite("debugAdapterFactory Tests", () => {
    const mockAdapter = mockGlobalModule(DebugAdapter);
    let mockContext: MockedObject<WorkspaceContext>;
    let mockToolchain: MockedObject<SwiftToolchain>;
    const mockSession = mockObject<vscode.DebugSession>({});

    setup(() => {
        mockToolchain = mockObject<SwiftToolchain>({});
        mockContext = mockObject<WorkspaceContext>({
            toolchain: instance(mockToolchain),
        });
    });

    test("should return DebugAdapterExecutable when path and verification succeed", async () => {
        const toolchainPath = "/path/to/debug/adapter";

        mockAdapter.debugAdapterPath.resolves(toolchainPath);
        mockAdapter.verifyDebugAdapterExists.resolves(true);

        const factory = new LLDBDebugAdapterExecutableFactory(instance(mockContext));
        const result = await factory.createDebugAdapterDescriptor(instance(mockSession), undefined);

        expect(result).to.be.instanceOf(vscode.DebugAdapterExecutable);
        expect((result as vscode.DebugAdapterExecutable).command).to.equal(toolchainPath);

        expect(mockAdapter.debugAdapterPath).to.have.been.calledOnce;
        expect(mockAdapter.verifyDebugAdapterExists).to.have.been.calledOnce;
    });

    test("should throw error if debugAdapterPath fails", async () => {
        const errorMessage = "Failed to get debug adapter path";

        mockAdapter.debugAdapterPath.rejects(new Error(errorMessage));

        const factory = new LLDBDebugAdapterExecutableFactory(instance(mockContext));

        await expect(
            factory.createDebugAdapterDescriptor(instance(mockSession), undefined)
        ).to.eventually.be.rejectedWith(Error, errorMessage);

        expect(mockAdapter.debugAdapterPath).to.have.been.calledOnce;
        expect(mockAdapter.verifyDebugAdapterExists).to.not.have.been.called;
    });

    test("should throw error if verifyDebugAdapterExists fails", async () => {
        const toolchainPath = "/path/to/debug/adapter";
        const errorMessage = "Failed to verify debug adapter exists";

        mockAdapter.debugAdapterPath.resolves(toolchainPath);
        mockAdapter.verifyDebugAdapterExists.rejects(new Error(errorMessage));

        const factory = new LLDBDebugAdapterExecutableFactory(instance(mockContext));

        await expect(
            factory.createDebugAdapterDescriptor(instance(mockSession), undefined)
        ).to.eventually.be.rejectedWith(Error, errorMessage);

        expect(mockAdapter.debugAdapterPath).to.have.been.calledOnce;
        expect(mockAdapter.verifyDebugAdapterExists).to.have.been.calledOnce;
    });
});

suite("LLDBDebugConfigurationProvider Tests", () => {
    let provider: LLDBDebugConfigurationProvider;
    const swift6 = new Version(6, 0, 0);

    setup(() => {
        provider = new LLDBDebugConfigurationProvider("darwin", swift6);
    });

    test("should convert environment variables to string[] format", () => {
        const env = {
            VAR1: "value1",
            VAR2: "value2",
        };

        const result = provider.convertEnvironmentVariables(env);

        expect(result).to.deep.equal(["VAR1=value1", "VAR2=value2"]);
    });

    test("should return undefined when environment variables are undefined", () => {
        const result = provider.convertEnvironmentVariables(undefined);
        expect(result).to.deep.equal(undefined);
    });

    test("should resolve debug configuration with converted environment variables", async () => {
        const launchConfig: vscode.DebugConfiguration = {
            type: "swift-lldb",
            request: "launch",
            name: "Test Launch",
            env: {
                VAR1: "value1",
                VAR2: "value2",
            },
        };

        const resolvedConfig = await provider.resolveDebugConfiguration(undefined, launchConfig);

        expect(resolvedConfig.env).to.deep.equal(["VAR1=value1", "VAR2=value2"]);
    });

    test("should handle one environment variable", () => {
        const env = {
            VAR1: "value1",
        };
        const result = provider.convertEnvironmentVariables(env);

        expect(result).to.deep.equal(["VAR1=value1"]);
    });

    test("should handle empty environment variables", () => {
        const env = {};
        const result = provider.convertEnvironmentVariables(env);

        expect(result).to.deep.equal([]);
    });

    test("should handle a large number of environment variables", () => {
        // Create 1000 environment variables
        const env: { [key: string]: string } = {};
        for (let i = 0; i < 1000; i++) {
            env[`VAR${i}`] = `value${i}`;
        }

        const result = provider.convertEnvironmentVariables(env);

        // Verify that all 1000 environment variables are properly converted
        const expected = Array.from({ length: 1000 }, (_, i) => `VAR${i}=value${i}`);
        expect(result).to.deep.equal(expected);
    });
});
