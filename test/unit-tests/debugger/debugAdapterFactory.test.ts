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
import * as assert from "assert";
import { expect } from "chai";
import { mock, when, instance, verify, spy, anything, reset } from "ts-mockito";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { DebugAdapter } from "../../../src/debugger/debugAdapter";
import {
    LLDBDebugAdapterExecutableFactory,
    LLDBDebugConfigurationProvider,
} from "../../../src/debugger/debugAdapterFactory";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { Version } from "../../../src/utilities/version";
import { mockGlobalObject } from "../../MockUtils";
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
    let mockContext: WorkspaceContext;
    const mockToolchain = mock(SwiftToolchain);
    let mockSession: vscode.DebugSession;

    setup(() => {
        mockContext = mock(WorkspaceContext);
        when(mockContext.toolchain).thenReturn(instance(mockToolchain));
        mockSession = mock<vscode.DebugSession>();
    });

    test("should return DebugAdapterExecutable when path and verification succeed", async () => {
        const spyAdapter = spy(DebugAdapter);
        const toolchainPath = "/path/to/debug/adapter";

        when(spyAdapter.debugAdapterPath(anything())).thenResolve(toolchainPath);
        when(spyAdapter.verifyDebugAdapterExists(anything())).thenResolve(true);

        const factory = new LLDBDebugAdapterExecutableFactory(instance(mockContext));
        const result = await factory.createDebugAdapterDescriptor(instance(mockSession), undefined);

        assert.strictEqual(result instanceof vscode.DebugAdapterExecutable, true);
        assert.strictEqual((result as vscode.DebugAdapterExecutable).command, toolchainPath);

        verify(spyAdapter.debugAdapterPath(anything())).once();
        verify(spyAdapter.verifyDebugAdapterExists(anything())).once();
        reset(spyAdapter);
    });

    test("should throw error if debugAdapterPath fails", async () => {
        const spyAdapter = spy(DebugAdapter);
        const errorMessage = "Failed to get debug adapter path";

        when(spyAdapter.debugAdapterPath(anything())).thenReject(new Error(errorMessage));

        const factory = new LLDBDebugAdapterExecutableFactory(instance(mockContext));

        await assert.rejects(async () => {
            await factory.createDebugAdapterDescriptor(instance(mockSession), undefined);
        }, new Error(errorMessage));

        verify(spyAdapter.debugAdapterPath(anything())).once();
        verify(spyAdapter.verifyDebugAdapterExists(anything())).never();
        reset(spyAdapter);
    });

    test("should throw error if verifyDebugAdapterExists fails", async () => {
        const spyAdapter = spy(DebugAdapter);
        const toolchainPath = "/path/to/debug/adapter";
        const errorMessage = "Failed to verify debug adapter exists";

        when(spyAdapter.debugAdapterPath(instance(mockContext).toolchain)).thenResolve(
            toolchainPath
        );
        when(spyAdapter.verifyDebugAdapterExists(instance(mockContext))).thenReject(
            new Error(errorMessage)
        );

        const factory = new LLDBDebugAdapterExecutableFactory(instance(mockContext));

        await assert.rejects(async () => {
            await factory.createDebugAdapterDescriptor(instance(mockSession), undefined);
        }, new Error(errorMessage));

        // Verify that both methods were called
        verify(spyAdapter.debugAdapterPath(anything())).once();
        verify(spyAdapter.verifyDebugAdapterExists(anything())).once();
        reset(spyAdapter);
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

        assert.deepStrictEqual(result, ["VAR1=value1", "VAR2=value2"]);
    });

    test("should return undefined when environment variables are undefined", () => {
        const result = provider.convertEnvironmentVariables(undefined);
        assert.strictEqual(result, undefined);
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

        assert.deepStrictEqual(resolvedConfig.env, ["VAR1=value1", "VAR2=value2"]);
    });

    test("should handle one environment variable", () => {
        const env = {
            VAR1: "value1",
        };
        const result = provider.convertEnvironmentVariables(env);

        assert.deepStrictEqual(result, ["VAR1=value1"]);
    });

    test("should handle empty environment variables", () => {
        const env = {};
        const result = provider.convertEnvironmentVariables(env);

        assert.deepStrictEqual(result, []);
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
        assert.deepStrictEqual(result, expected);
    });
});
