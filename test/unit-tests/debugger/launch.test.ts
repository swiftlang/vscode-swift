//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
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

import { FolderContext } from "@src/FolderContext";
import { Product, SwiftPackage } from "@src/SwiftPackage";
import { WorkspaceContext } from "@src/WorkspaceContext";
import configuration, { FolderConfiguration } from "@src/configuration";
import { SWIFT_LAUNCH_CONFIG_TYPE } from "@src/debugger/debugAdapter";
import {
    getLaunchConfiguration,
    makeDebugConfigurations,
    swiftPrelaunchBuildTaskArguments,
} from "@src/debugger/launch";
import { SwiftLogger } from "@src/logging/SwiftLogger";
import { BuildFlags } from "@src/toolchain/BuildFlags";
import { SwiftToolchain } from "@src/toolchain/toolchain";

import {
    MockedObject,
    instance,
    mockFn,
    mockGlobalModule,
    mockGlobalObject,
    mockObject,
} from "../../MockUtils";

suite("Launch Configurations Test", () => {
    const mockConfiguration = mockGlobalModule(configuration);
    let mockFolderConfiguration: MockedObject<FolderConfiguration>;
    const mockWorkspace = mockGlobalObject(vscode, "workspace");
    let mockLaunchWSConfig: MockedObject<vscode.WorkspaceConfiguration>;

    // Create a mock folder to be used by each test
    const folderURI = vscode.Uri.file("/path/to/folder");
    const swiftPackage = mockObject<SwiftPackage>({
        executableProducts: Promise.resolve<Product[]>([
            { name: "executable", targets: [], type: { executable: null } },
        ]),
    });
    const folder = mockObject<FolderContext>({
        folder: folderURI,
        workspaceFolder: {
            index: 0,
            name: "folder",
            uri: folderURI,
        },
        relativePath: "",
        swiftPackage: instance(swiftPackage),
    });

    setup(() => {
        mockFolderConfiguration = mockObject<FolderConfiguration>({
            autoGenerateLaunchConfigurations: true,
        });
        mockConfiguration.folder.returns(mockFolderConfiguration);
        mockLaunchWSConfig = mockObject<vscode.WorkspaceConfiguration>({
            get: mockFn(),
            update: mockFn(),
        });
        mockWorkspace.getConfiguration.withArgs("launch").returns(instance(mockLaunchWSConfig));
        mockLaunchWSConfig.get.withArgs("configurations").returns([]);
    });

    test("generates launch configurations for executable products", async () => {
        expect(await makeDebugConfigurations(instance(folder), { yes: true })).to.be.true;
        expect(mockLaunchWSConfig.update).to.have.been.calledWith(
            "configurations",
            [
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Debug executable",
                    target: "executable",
                    configuration: "debug",
                    preLaunchTask: "swift: Build Debug executable",
                },
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Release executable",
                    target: "executable",
                    configuration: "release",
                    preLaunchTask: "swift: Build Release executable",
                },
            ],
            vscode.ConfigurationTarget.WorkspaceFolder
        );
    });

    test("doesn't generate launch configurations if disabled in settings", async () => {
        mockFolderConfiguration.autoGenerateLaunchConfigurations = false;

        expect(await makeDebugConfigurations(instance(folder), { yes: true })).to.be.false;
        expect(mockLaunchWSConfig.update).to.not.have.been.called;
    });

    test("forces the generation of launch configurations if force is set to true", async () => {
        mockFolderConfiguration.autoGenerateLaunchConfigurations = false;

        expect(await makeDebugConfigurations(instance(folder), { force: true, yes: true })).to.be
            .true;
        expect(mockLaunchWSConfig.update).to.have.been.calledWith(
            "configurations",
            [
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Debug executable",
                    target: "executable",
                    configuration: "debug",
                    preLaunchTask: "swift: Build Debug executable",
                },
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Release executable",
                    target: "executable",
                    configuration: "release",
                    preLaunchTask: "swift: Build Release executable",
                },
            ],
            vscode.ConfigurationTarget.WorkspaceFolder
        );
    });

    test("updates launch configurations that have old lldb/swift-lldb types", async () => {
        mockLaunchWSConfig.get.withArgs("configurations").returns([
            {
                type: "swift-lldb",
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Debug executable",
                target: "executable",
                configuration: "debug",
                preLaunchTask: "swift: Build Debug executable",
            },
            {
                type: "lldb",
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Release executable",
                target: "executable",
                configuration: "release",
                preLaunchTask: "swift: Build Release executable",
            },
        ]);

        expect(await makeDebugConfigurations(instance(folder), { yes: true })).to.be.true;
        expect(mockLaunchWSConfig.update).to.have.been.calledWith(
            "configurations",
            [
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Debug executable",
                    target: "executable",
                    configuration: "debug",
                    preLaunchTask: "swift: Build Debug executable",
                },
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Release executable",
                    target: "executable",
                    configuration: "release",
                    preLaunchTask: "swift: Build Release executable",
                },
            ],
            vscode.ConfigurationTarget.WorkspaceFolder
        );
    });

    test("doesn't update launch configurations if disabled in settings", async () => {
        mockFolderConfiguration.autoGenerateLaunchConfigurations = false;
        mockLaunchWSConfig.get.withArgs("configurations").returns([
            {
                type: "swift-lldb",
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Debug executable",
                target: "executable",
                configuration: "debug",
                preLaunchTask: "swift: Build Debug executable",
            },
            {
                type: "lldb",
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Release executable",
                target: "executable",
                configuration: "release",
                preLaunchTask: "swift: Build Release executable",
            },
        ]);

        expect(await makeDebugConfigurations(instance(folder), { yes: true })).to.be.false;
        expect(mockLaunchWSConfig.update).to.not.have.been.called;
    });

    test("forces the updating of launch configurations if force is set to true", async () => {
        mockFolderConfiguration.autoGenerateLaunchConfigurations = false;
        mockLaunchWSConfig.get.withArgs("configurations").returns([
            {
                type: "swift-lldb",
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Debug executable",
                target: "executable",
                configuration: "debug",
                preLaunchTask: "swift: Build Debug executable",
            },
            {
                type: "lldb",
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Release executable",
                target: "executable",
                configuration: "release",
                preLaunchTask: "swift: Build Release executable",
            },
        ]);

        expect(await makeDebugConfigurations(instance(folder), { force: true, yes: true })).to.be
            .true;
        expect(mockLaunchWSConfig.update).to.have.been.calledWith(
            "configurations",
            [
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Debug executable",
                    target: "executable",
                    configuration: "debug",
                    preLaunchTask: "swift: Build Debug executable",
                },
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Release executable",
                    target: "executable",
                    configuration: "release",
                    preLaunchTask: "swift: Build Release executable",
                },
            ],
            vscode.ConfigurationTarget.WorkspaceFolder
        );
    });

    test("doesn't update launch configurations if they already exist", async () => {
        mockLaunchWSConfig.get.withArgs("configurations").returns([
            {
                type: SWIFT_LAUNCH_CONFIG_TYPE,
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Debug executable",
                target: "executable",
                configuration: "debug",
                preLaunchTask: "swift: Build Debug executable",
            },
            {
                type: SWIFT_LAUNCH_CONFIG_TYPE,
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Release executable",
                target: "executable",
                configuration: "release",
                preLaunchTask: "swift: Build Release executable",
            },
        ]);

        expect(await makeDebugConfigurations(instance(folder), { yes: true })).to.be.false;
        expect(mockLaunchWSConfig.update).to.not.have.been.called;
    });
});

suite("Swift PreLaunch Build Task Arguments Test", () => {
    const mockTasks = mockGlobalObject(vscode, "tasks");

    setup(() => {
        // Reset mocks before each test
        mockTasks.fetchTasks.reset();
    });

    test("swiftPrelaunchBuildTaskArguments returns task args for Swift build task", async () => {
        const expectedArgs = ["build", "--product", "executable", "--build-system"];
        const mockTask = mockObject<vscode.Task>({
            name: "swift: Build Debug executable",
            definition: {
                type: "swift",
                args: expectedArgs,
            },
            scope: vscode.TaskScope.Workspace,
            source: "swift",
            isBackground: false,
            presentationOptions: {},
            problemMatchers: [],
            runOptions: {},
        });

        mockTasks.fetchTasks.resolves([instance(mockTask)]);

        const launchConfig: vscode.DebugConfiguration = {
            type: "swift",
            request: "launch",
            name: "Debug executable",
            preLaunchTask: "swift: Build Debug executable",
        };

        const result = await swiftPrelaunchBuildTaskArguments(launchConfig);
        expect(result).to.deep.equal(expectedArgs);
    });

    test("swiftPrelaunchBuildTaskArguments returns undefined for non-Swift task", async () => {
        const mockTask = mockObject<vscode.Task>({
            name: "npm: build",
            definition: {
                type: "npm",
                args: ["run", "build"],
            },
            scope: vscode.TaskScope.Workspace,
            source: "npm",
            isBackground: false,
            presentationOptions: {},
            problemMatchers: [],
            runOptions: {},
        });

        mockTasks.fetchTasks.resolves([instance(mockTask)]);

        const launchConfig: vscode.DebugConfiguration = {
            type: "swift",
            request: "launch",
            name: "Debug executable",
            preLaunchTask: "npm: build",
        };

        const result = await swiftPrelaunchBuildTaskArguments(launchConfig);
        expect(result).to.be.undefined;
    });

    test("swiftPrelaunchBuildTaskArguments returns undefined for Swift task without build arg", async () => {
        const mockTask = mockObject<vscode.Task>({
            name: "swift: Test",
            definition: {
                type: "swift",
                args: ["test", "--build-system"],
            },
            scope: vscode.TaskScope.Workspace,
            source: "swift",
            isBackground: false,
            presentationOptions: {},
            problemMatchers: [],
            runOptions: {},
        });

        mockTasks.fetchTasks.resolves([instance(mockTask)]);

        const launchConfig: vscode.DebugConfiguration = {
            type: "swift",
            request: "launch",
            name: "Debug executable",
            preLaunchTask: "swift: Test",
        };

        const result = await swiftPrelaunchBuildTaskArguments(launchConfig);
        expect(result).to.be.undefined;
    });

    test("swiftPrelaunchBuildTaskArguments returns undefined for launch config without preLaunchTask", async () => {
        const launchConfig: vscode.DebugConfiguration = {
            type: "swift",
            request: "launch",
            name: "Debug executable",
        };

        const result = await swiftPrelaunchBuildTaskArguments(launchConfig);
        expect(result).to.be.undefined;
    });

    test("swiftPrelaunchBuildTaskArguments handles errors gracefully", async () => {
        mockTasks.fetchTasks.rejects(new Error("Failed to fetch tasks"));

        const launchConfig: vscode.DebugConfiguration = {
            type: "swift",
            request: "launch",
            name: "Debug executable",
            preLaunchTask: "swift: Build Debug executable",
        };

        const result = await swiftPrelaunchBuildTaskArguments(launchConfig);
        expect(result).to.be.undefined;
    });

    test("swiftPrelaunchBuildTaskArguments handles task name variations", async () => {
        const expectedArgs = ["build", "--product", "executable", "--build-system"];
        const mockTask = mockObject<vscode.Task>({
            name: "Build Debug executable",
            definition: {
                type: "swift",
                args: expectedArgs,
            },
            scope: vscode.TaskScope.Workspace,
            source: "swift",
            isBackground: false,
            presentationOptions: {},
            problemMatchers: [],
            runOptions: {},
        });

        mockTasks.fetchTasks.resolves([instance(mockTask)]);

        const launchConfig: vscode.DebugConfiguration = {
            type: "swift",
            request: "launch",
            name: "Debug executable",
            preLaunchTask: "swift: Build Debug executable",
        };

        const result = await swiftPrelaunchBuildTaskArguments(launchConfig);
        expect(result).to.deep.equal(expectedArgs);
    });
});

suite("getLaunchConfiguration Tests", () => {
    mockGlobalModule(configuration);
    const mockWorkspace = mockGlobalObject(vscode, "workspace");

    const folderPath = "/path/to/myPkg";
    const folderURI = vscode.Uri.file(folderPath);
    const workspaceFolder: vscode.WorkspaceFolder = {
        index: 0,
        name: "myPkg",
        uri: folderURI,
    };

    let mockBuildFlags: MockedObject<BuildFlags>;
    let mockLaunchWSConfig: MockedObject<vscode.WorkspaceConfiguration>;
    let mockFolderCtx: MockedObject<FolderContext>;

    setup(() => {
        mockBuildFlags = mockObject<BuildFlags>({ getBuildBinaryPath: mockFn() });
        const mockToolchain = mockObject<SwiftToolchain>({
            buildFlags: instance(mockBuildFlags),
        });
        const mockLogger = mockObject<SwiftLogger>({
            info: mockFn(),
        });
        const mockWorkspaceCtx = mockObject<WorkspaceContext>({
            logger: instance(mockLogger),
        });
        mockFolderCtx = mockObject<FolderContext>({
            folder: folderURI,
            workspaceFolder: workspaceFolder,
            toolchain: instance(mockToolchain),
            workspaceContext: instance(mockWorkspaceCtx),
        });

        mockWorkspace.workspaceFile = undefined;
        mockWorkspace.workspaceFolders = [workspaceFolder];
        mockLaunchWSConfig = mockObject<vscode.WorkspaceConfiguration>({
            get: mockFn(),
        });
        mockWorkspace.getConfiguration
            .withArgs("launch", workspaceFolder)
            .returns(instance(mockLaunchWSConfig));
    });

    test("matches config using ${binPath} variable in program path", async () => {
        mockBuildFlags.getBuildBinaryPath.resolves(`${folderPath}/.build/out/Products/Debug`);
        mockLaunchWSConfig.get.withArgs("configurations").returns([
            {
                type: "swift",
                request: "launch",
                name: "Debug MyExe",
                program: "${workspaceFolder:myPkg}/${binPath}/MyExe",
                args: [],
                cwd: "${workspaceFolder:myPkg}",
            },
        ]);

        const result = await getLaunchConfiguration("MyExe", "debug", instance(mockFolderCtx));
        expect(result).to.not.be.undefined;
        expect(result?.name).to.equal("Debug MyExe");
    });

    test("matches config using ${binPath} with legacy debug path", async () => {
        mockBuildFlags.getBuildBinaryPath.resolves(`${folderPath}/.build/debug`);
        mockLaunchWSConfig.get.withArgs("configurations").returns([
            {
                type: "swift",
                request: "launch",
                name: "Debug MyExe",
                program: "${workspaceFolder:myPkg}/${binPath}/MyExe",
                args: [],
                cwd: "${workspaceFolder:myPkg}",
            },
        ]);

        const result = await getLaunchConfiguration("MyExe", "debug", instance(mockFolderCtx));
        expect(result).to.not.be.undefined;
        expect(result?.name).to.equal("Debug MyExe");
    });

    test("matches release config using ${binPath} with new-style path", async () => {
        mockBuildFlags.getBuildBinaryPath.resolves(`${folderPath}/.build/out/Products/Release`);
        mockLaunchWSConfig.get.withArgs("configurations").returns([
            {
                type: "swift",
                request: "launch",
                name: "Debug MyExe",
                program: "${workspaceFolder:myPkg}/${binPath}/MyExe",
                configuration: "debug",
                args: [],
                cwd: "${workspaceFolder:myPkg}",
            },
            {
                type: "swift",
                request: "launch",
                name: "Release MyExe",
                program: "${workspaceFolder:myPkg}/${binPath}/MyExe",
                configuration: "release",
                args: [],
                cwd: "${workspaceFolder:myPkg}",
            },
        ]);

        const result = await getLaunchConfiguration("MyExe", "release", instance(mockFolderCtx));
        expect(result).to.not.be.undefined;
        expect(result?.name).to.equal("Release MyExe");
    });
});
