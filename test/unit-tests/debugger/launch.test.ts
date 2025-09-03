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

import * as vscode from "vscode";
import { expect } from "chai";
import configuration, { FolderConfiguration } from "@src/configuration";
import { makeDebugConfigurations } from "@src/debugger/launch";
import { FolderContext } from "@src/FolderContext";
import {
    instance,
    MockedObject,
    mockFn,
    mockGlobalModule,
    mockGlobalObject,
    mockObject,
} from "../../MockUtils";
import { Product, SwiftPackage } from "@src/SwiftPackage";
import { SWIFT_LAUNCH_CONFIG_TYPE } from "@src/debugger/debugAdapter";

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
                    program: "${workspaceFolder:folder}/.build/debug/executable",
                    preLaunchTask: "swift: Build Debug executable",
                },
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Release executable",
                    program: "${workspaceFolder:folder}/.build/release/executable",
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
                    program: "${workspaceFolder:folder}/.build/debug/executable",
                    preLaunchTask: "swift: Build Debug executable",
                },
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Release executable",
                    program: "${workspaceFolder:folder}/.build/release/executable",
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
                program: "${workspaceFolder:folder}/.build/debug/executable",
                preLaunchTask: "swift: Build Debug executable",
            },
            {
                type: "lldb",
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Release executable",
                program: "${workspaceFolder:folder}/.build/release/executable",
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
                    program: "${workspaceFolder:folder}/.build/debug/executable",
                    preLaunchTask: "swift: Build Debug executable",
                },
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Release executable",
                    program: "${workspaceFolder:folder}/.build/release/executable",
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
                program: "${workspaceFolder:folder}/.build/debug/executable",
                preLaunchTask: "swift: Build Debug executable",
            },
            {
                type: "lldb",
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Release executable",
                program: "${workspaceFolder:folder}/.build/release/executable",
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
                program: "${workspaceFolder:folder}/.build/debug/executable",
                preLaunchTask: "swift: Build Debug executable",
            },
            {
                type: "lldb",
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Release executable",
                program: "${workspaceFolder:folder}/.build/release/executable",
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
                    program: "${workspaceFolder:folder}/.build/debug/executable",
                    preLaunchTask: "swift: Build Debug executable",
                },
                {
                    type: SWIFT_LAUNCH_CONFIG_TYPE,
                    request: "launch",
                    args: [],
                    cwd: "${workspaceFolder:folder}",
                    name: "Release executable",
                    program: "${workspaceFolder:folder}/.build/release/executable",
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
                program: "${workspaceFolder:folder}/.build/debug/executable",
                preLaunchTask: "swift: Build Debug executable",
            },
            {
                type: SWIFT_LAUNCH_CONFIG_TYPE,
                request: "launch",
                args: [],
                cwd: "${workspaceFolder:folder}",
                name: "Release executable",
                program: "${workspaceFolder:folder}/.build/release/executable",
                preLaunchTask: "swift: Build Release executable",
            },
        ]);

        expect(await makeDebugConfigurations(instance(folder), { yes: true })).to.be.false;
        expect(mockLaunchWSConfig.update).to.not.have.been.called;
    });
});
