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
import { LLDBDebugConfigurationProvider } from "../../../src/debugger/debugAdapterFactory";
import { Version } from "../../../src/utilities/version";
import {
    mockGlobalObject,
    MockedObject,
    mockObject,
    instance,
    mockGlobalModule,
    mockFn,
} from "../../MockUtils";
import * as mockFS from "mock-fs";
import { LaunchConfigType, SWIFT_LAUNCH_CONFIG_TYPE } from "../../../src/debugger/debugAdapter";
import * as lldb from "../../../src/debugger/lldb";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";
import * as debugAdapter from "../../../src/debugger/debugAdapter";
import { Result } from "../../../src/utilities/result";
import configuration from "../../../src/configuration";

suite("LLDBDebugConfigurationProvider Tests", () => {
    let mockToolchain: MockedObject<SwiftToolchain>;
    let mockOutputChannel: MockedObject<SwiftOutputChannel>;
    const mockDebugAdapter = mockGlobalObject(debugAdapter, "DebugAdapter");
    const mockWindow = mockGlobalObject(vscode, "window");

    setup(() => {
        mockToolchain = mockObject<SwiftToolchain>({ swiftVersion: new Version(6, 0, 0) });
        mockOutputChannel = mockObject<SwiftOutputChannel>({
            log: mockFn(),
        });
    });

    suite("CodeLLDB selected in settings", () => {
        let mockLldbConfiguration: MockedObject<vscode.WorkspaceConfiguration>;
        const mockLLDB = mockGlobalModule(lldb);
        const mockDebuggerConfig = mockGlobalObject(configuration, "debugger");
        const mockWorkspace = mockGlobalObject(vscode, "workspace");
        const mockExtensions = mockGlobalObject(vscode, "extensions");
        const mockCommands = mockGlobalObject(vscode, "commands");

        setup(() => {
            mockExtensions.getExtension.returns(mockObject<vscode.Extension<unknown>>({}));
            mockLldbConfiguration = mockObject<vscode.WorkspaceConfiguration>({
                get: mockFn(s => {
                    s.withArgs("library").returns("/path/to/liblldb.dyLib");
                    s.withArgs("launch.expressions").returns("native");
                }),
                update: mockFn(),
            });
            mockWorkspace.getConfiguration.returns(instance(mockLldbConfiguration));
            mockLLDB.getLLDBLibPath.resolves(Result.makeSuccess("/path/to/liblldb.dyLib"));
            mockDebuggerConfig.setupCodeLLDB = "prompt";
            mockDebugAdapter.getLaunchConfigType.returns(LaunchConfigType.CODE_LLDB);
        });

        test("returns a launch configuration that uses CodeLLDB as the debug adapter", async () => {
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            const launchConfig =
                await configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                    name: "Test Launch Config",
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    program: "${workspaceFolder}/.build/debug/executable",
                });
            expect(launchConfig).to.containSubset({ type: LaunchConfigType.CODE_LLDB });
        });

        test("prompts the user to install CodeLLDB if it isn't found", async () => {
            mockExtensions.getExtension.returns(undefined);
            mockWindow.showErrorMessage.resolves("Install CodeLLDB" as any);
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            await expect(
                configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                    name: "Test Launch Config",
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    program: "${workspaceFolder}/.build/debug/executable",
                })
            ).to.eventually.not.be.undefined;
            expect(mockCommands.executeCommand).to.have.been.calledWith(
                "workbench.extensions.installExtension",
                "vadimcn.vscode-lldb"
            );
        });

        test("prompts the user to update CodeLLDB settings if they aren't configured yet", async () => {
            mockLldbConfiguration.get.withArgs("library").returns(undefined);
            mockWindow.showInformationMessage.resolves("Global" as any);
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            await expect(
                configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                    name: "Test Launch Config",
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    program: "${workspaceFolder}/.build/debug/executable",
                })
            ).to.eventually.not.be.undefined;
            expect(mockWindow.showInformationMessage).to.have.been.calledOnce;
            expect(mockLldbConfiguration.update).to.have.been.calledWith(
                "library",
                "/path/to/liblldb.dyLib"
            );
        });

        test("avoids prompting the user about CodeLLDB if requested in settings", async () => {
            mockDebuggerConfig.setupCodeLLDB = "alwaysUpdateGlobal";
            mockLldbConfiguration.get.withArgs("library").returns(undefined);
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            await expect(
                configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                    name: "Test Launch Config",
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    program: "${workspaceFolder}/.build/debug/executable",
                })
            ).to.eventually.be.an("object");
            expect(mockWindow.showInformationMessage).to.not.have.been.called;
            expect(mockLldbConfiguration.update).to.have.been.calledWith(
                "library",
                "/path/to/liblldb.dyLib"
            );
        });
    });

    suite("lldb-dap selected in settings", () => {
        setup(() => {
            mockDebugAdapter.getLaunchConfigType.returns(LaunchConfigType.LLDB_DAP);
            mockDebugAdapter.getLLDBDebugAdapterPath.resolves("/path/to/lldb-dap");
            mockFS({
                "/path/to/lldb-dap": mockFS.file({ content: "", mode: 0o770 }),
            });
        });

        teardown(() => {
            mockFS.restore();
        });

        test("returns a launch configuration that uses lldb-dap as the debug adapter", async () => {
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            const launchConfig =
                await configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                    name: "Test Launch Config",
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    program: "${workspaceFolder}/.build/debug/executable",
                });
            expect(launchConfig).to.containSubset({
                type: LaunchConfigType.LLDB_DAP,
                debugAdapterExecutable: "/path/to/lldb-dap",
            });
        });

        test("fails if the path to lldb-dap could not be found", async () => {
            mockFS({}); // Reset mockFS so that no files exist
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            await expect(
                configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                    name: "Test Launch Config",
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    program: "${workspaceFolder}/.build/debug/executable",
                })
            ).to.eventually.be.undefined;
            expect(mockWindow.showErrorMessage).to.have.been.calledOnce;
        });

        test("modifies program to add file extension on Windows", async () => {
            const configProvider = new LLDBDebugConfigurationProvider(
                "win32",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            const launchConfig =
                await configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
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
            const configProvider = new LLDBDebugConfigurationProvider(
                "win32",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            const launchConfig =
                await configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
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
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            const launchConfig =
                await configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
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
            const configProvider = new LLDBDebugConfigurationProvider(
                "linux",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            const launchConfig =
                await configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
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
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            const launchConfig =
                await configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
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
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            const launchConfig =
                await configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                    name: "Test Launch Config",
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    program: "${workspaceFolder}/.build/debug/executable",
                });
            expect(launchConfig).to.not.have.property("env");
        });

        test("should convert empty environment variables when using lldb-dap", async () => {
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            const launchConfig =
                await configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    name: "Test Launch",
                    env: {},
                });

            expect(launchConfig).to.have.property("env").that.deep.equals([]);
        });

        test("should handle a large number of environment variables when using lldb-dap", async () => {
            // Create 1000 environment variables
            const env: { [key: string]: string } = {};
            for (let i = 0; i < 1000; i++) {
                env[`VAR${i}`] = `value${i}`;
            }
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockToolchain),
                instance(mockOutputChannel)
            );
            const launchConfig =
                await configProvider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
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
});
