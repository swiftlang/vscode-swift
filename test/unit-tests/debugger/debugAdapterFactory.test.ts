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
import * as mockFS from "mock-fs";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import configuration from "@src/configuration";
import { LaunchConfigType, SWIFT_LAUNCH_CONFIG_TYPE } from "@src/debugger/debugAdapter";
import * as debugAdapter from "@src/debugger/debugAdapter";
import { LLDBDebugConfigurationProvider } from "@src/debugger/debugAdapterFactory";
import * as lldb from "@src/debugger/lldb";
import { SwiftLogger } from "@src/logging/SwiftLogger";
import { BuildFlags } from "@src/toolchain/BuildFlags";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Result } from "@src/utilities/result";
import { Version } from "@src/utilities/version";

import {
    MockedObject,
    instance,
    mockFn,
    mockGlobalModule,
    mockGlobalObject,
    mockObject,
} from "../../MockUtils";

suite("LLDBDebugConfigurationProvider Tests", () => {
    let mockWorkspaceContext: MockedObject<WorkspaceContext>;
    let mockToolchain: MockedObject<SwiftToolchain>;
    let mockBuildFlags: MockedObject<BuildFlags>;
    let mockLogger: MockedObject<SwiftLogger>;
    const mockDebugAdapter = mockGlobalObject(debugAdapter, "DebugAdapter");
    const mockWindow = mockGlobalObject(vscode, "window");

    setup(() => {
        mockBuildFlags = mockObject<BuildFlags>({ getBuildBinaryPath: mockFn() });
        mockToolchain = mockObject<SwiftToolchain>({
            swiftVersion: new Version(6, 0, 0),
            buildFlags: instance(mockBuildFlags),
        });
        mockLogger = mockObject<SwiftLogger>({
            info: mockFn(),
        });
        mockWorkspaceContext = mockObject<WorkspaceContext>({
            globalToolchain: instance(mockToolchain),
            globalToolchainSwiftVersion: new Version(6, 0, 0),
            logger: instance(mockLogger),
            subscriptions: [],
            folders: [],
        });
    });

    test("allows specifying a 'pid' in the launch configuration", async () => {
        const configProvider = new LLDBDebugConfigurationProvider(
            "darwin",
            instance(mockWorkspaceContext),
            instance(mockLogger)
        );
        const launchConfig = await configProvider.resolveDebugConfigurationWithSubstitutedVariables(
            undefined,
            {
                name: "Test Launch Config",
                type: SWIFT_LAUNCH_CONFIG_TYPE,
                request: "attach",
                pid: 41038,
            }
        );
        expect(launchConfig).to.containSubset({ pid: 41038 });
    });

    test("converts 'pid' property from a string to a number", async () => {
        const configProvider = new LLDBDebugConfigurationProvider(
            "darwin",
            instance(mockWorkspaceContext),
            instance(mockLogger)
        );
        const launchConfig = await configProvider.resolveDebugConfigurationWithSubstitutedVariables(
            undefined,
            {
                name: "Test Launch Config",
                type: SWIFT_LAUNCH_CONFIG_TYPE,
                request: "attach",
                pid: "41038",
            }
        );
        expect(launchConfig).to.containSubset({ pid: 41038 });
    });

    test("shows an error when the 'pid' property is a string that isn't a number", async () => {
        // Simulate the user clicking the "Configure" button
        mockWindow.showErrorMessage.resolves("Configure" as any);

        const configProvider = new LLDBDebugConfigurationProvider(
            "darwin",
            instance(mockWorkspaceContext),
            instance(mockLogger)
        );
        const launchConfig = await configProvider.resolveDebugConfigurationWithSubstitutedVariables(
            undefined,
            {
                name: "Test Launch Config",
                type: SWIFT_LAUNCH_CONFIG_TYPE,
                request: "attach",
                pid: "not-a-number",
            }
        );
        expect(launchConfig).to.be.null;
    });

    test("shows an error when the 'pid' property isn't a number or string", async () => {
        // Simulate the user clicking the "Configure" button
        mockWindow.showErrorMessage.resolves("Configure" as any);

        const configProvider = new LLDBDebugConfigurationProvider(
            "darwin",
            instance(mockWorkspaceContext),
            instance(mockLogger)
        );
        const launchConfig = await configProvider.resolveDebugConfigurationWithSubstitutedVariables(
            undefined,
            {
                name: "Test Launch Config",
                type: SWIFT_LAUNCH_CONFIG_TYPE,
                request: "attach",
                pid: {},
            }
        );
        expect(launchConfig).to.be.null;
    });

    test("sets the 'program' property if a 'target' property is present", async () => {
        mockBuildFlags.getBuildBinaryPath.resolves(
            "/path/to/swift-executable/.build/arm64-apple-macosx/debug/"
        );
        const folder: vscode.WorkspaceFolder = {
            index: 0,
            name: "swift-executable",
            uri: vscode.Uri.file("/path/to/swift-executable"),
        };
        const mockedFolderCtx = mockObject<FolderContext>({
            workspaceContext: instance(mockWorkspaceContext),
            workspaceFolder: folder,
            folder: folder.uri,
            toolchain: instance(mockToolchain),
            relativePath: "./",
        });
        mockWorkspaceContext.folders = [instance(mockedFolderCtx)];
        const configProvider = new LLDBDebugConfigurationProvider(
            "darwin",
            instance(mockWorkspaceContext),
            instance(mockLogger)
        );
        const launchConfig = await configProvider.resolveDebugConfigurationWithSubstitutedVariables(
            folder,
            {
                name: "Test Launch Config",
                type: SWIFT_LAUNCH_CONFIG_TYPE,
                request: "launch",
                target: "executable",
            }
        );
        expect(launchConfig).to.have.property(
            "program",
            path.normalize("/path/to/swift-executable/.build/arm64-apple-macosx/debug/executable")
        );
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
            mockLLDB.updateLaunchConfigForCI.returnsArg(0);
            mockLLDB.getLLDBLibPath.resolves(Result.makeSuccess("/path/to/liblldb.dyLib"));
            mockDebuggerConfig.setupCodeLLDB = "prompt";
            mockDebugAdapter.getLaunchConfigType.returns(LaunchConfigType.CODE_LLDB);
        });

        test("returns a launch configuration that uses CodeLLDB as the debug adapter", async () => {
            const configProvider = new LLDBDebugConfigurationProvider(
                "darwin",
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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
                instance(mockWorkspaceContext),
                instance(mockLogger)
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

    test("debugs with the toolchain of the supplied folder", async () => {
        const debugAdapterPath = "/path/to/lldb-dap";
        mockDebugAdapter.getLaunchConfigType.returns(LaunchConfigType.LLDB_DAP);
        mockDebugAdapter.getLLDBDebugAdapterPath.calledOnceWithExactly(mockToolchain);
        mockDebugAdapter.getLLDBDebugAdapterPath.resolves(debugAdapterPath);
        mockFS({
            [debugAdapterPath]: mockFS.file({ content: "", mode: 0o770 }),
        });
        mockToolchain = mockObject<SwiftToolchain>({ swiftVersion: new Version(5, 10, 0) });
        const mockFolder = mockObject<FolderContext>({
            isRootFolder: false,
            folder: vscode.Uri.file("/folder"),
            workspaceFolder: {
                uri: vscode.Uri.file("/folder"),
                name: "folder",
                index: 1,
            },
            toolchain: instance(mockToolchain),
        });
        mockWorkspaceContext.folders.push(instance(mockFolder));
        const configProvider = new LLDBDebugConfigurationProvider(
            "darwin",
            instance(mockWorkspaceContext),
            instance(mockLogger)
        );
        const launchConfig = await configProvider.resolveDebugConfigurationWithSubstitutedVariables(
            {
                uri: vscode.Uri.file("/folder"),
                name: "folder",
                index: 1,
            },
            {
                name: "Test Launch Config",
                type: SWIFT_LAUNCH_CONFIG_TYPE,
                request: "launch",
                program: "${workspaceFolder}/.build/debug/executable",
            }
        );
        expect(launchConfig).to.containSubset({
            debugAdapterExecutable: debugAdapterPath,
        });
    });
});
