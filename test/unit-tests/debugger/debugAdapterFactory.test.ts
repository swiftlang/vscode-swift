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

import * as assert from "assert";
import { DebugAdapter } from "../../../src/debugger/debugAdapter";
import { LLDBDebugConfigurationProvider } from "../../../src/debugger/debugAdapterFactory";
import { Version } from "../../../src/utilities/version";
import { mockNamespace } from "../MockUtils";
import configuration from "../../../src/configuration";
import { when } from "ts-mockito";

suite("Debug Adapter Factory Test Suite", () => {
    const swift6 = new Version(6, 0, 0);
    const swift510 = new Version(5, 10, 1);
    const mockDebugConfig = mockNamespace(configuration, "debugger");

    suite("LLDBDebugConfigurationProvider Test Suite", () => {
        setup(() => {
            when(mockDebugConfig.useDebugAdapterFromToolchain).thenReturn(true);
        });

        test("uses lldb-dap for swift versions >=6.0.0", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            assert.strictEqual(launchConfig.type, DebugAdapter.adapterName);
        });

        test("delegates to CodeLLDB for swift versions <6.0.0", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("darwin", swift510);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            assert.strictEqual(launchConfig.type, "lldb");
            assert.deepStrictEqual(launchConfig.sourceLanguages, ["swift"]);
        });

        test("delegates to CodeLLDB on Swift 6.0.0 if setting swift.debugger.useDebugAdapterFromToolchain is explicitly disabled", async () => {
            when(mockDebugConfig.useDebugAdapterFromToolchain).thenReturn(false);
            const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            assert.strictEqual(launchConfig.type, "lldb");
            assert.deepStrictEqual(launchConfig.sourceLanguages, ["swift"]);
        });

        test("modifies program to add file extension on Windows", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("win32", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            assert.strictEqual(
                launchConfig.program,
                "${workspaceFolder}/.build/debug/executable.exe"
            );
        });

        test("does not modify program on Windows if file extension is already present", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("win32", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable.exe",
            });
            assert.strictEqual(
                launchConfig.program,
                "${workspaceFolder}/.build/debug/executable.exe"
            );
        });

        test("does not modify program on macOS", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("darwin", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            assert.strictEqual(launchConfig.program, "${workspaceFolder}/.build/debug/executable");
        });

        test("does not modify program on Linux", async () => {
            const configProvider = new LLDBDebugConfigurationProvider("linux", swift6);
            const launchConfig = await configProvider.resolveDebugConfiguration(undefined, {
                name: "Test Launch Config",
                type: DebugAdapter.adapterName,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            });
            assert.strictEqual(launchConfig.program, "${workspaceFolder}/.build/debug/executable");
        });
    });
});
