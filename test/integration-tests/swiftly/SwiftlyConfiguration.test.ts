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
import * as vscode from "vscode";

import configuration from "@src/configuration";
import { checkForSwiftlyInstallation } from "@src/extension";
import { SwiftLogger } from "@src/logging/SwiftLogger";
import { Swiftly } from "@src/toolchain/swiftly";
import * as utilities from "@src/utilities/utilities";

import {
    instance,
    mockFn,
    mockGlobalFunction,
    mockGlobalModule,
    mockGlobalObject,
    mockGlobalValue,
    mockObject,
} from "../../MockUtils";
import { tag } from "../../tags";
import { activateExtensionForSuite } from "../utilities/testutilities";

tag("large").suite("Swiftly Configuration Tests", () => {
    const mockWindow = mockGlobalObject(vscode, "window");
    const mockWorkspaceFolders = mockGlobalValue(vscode.workspace, "workspaceFolders");
    const mockGetWorkspaceFolder = mockGlobalFunction(vscode.workspace, "getWorkspaceFolder");
    const mockUtilities = mockGlobalModule(utilities);
    const mockSwiftlyIsSupported = mockGlobalFunction(Swiftly, "isSupported");
    const mockSwiftlyIsInstalled = mockGlobalFunction(Swiftly, "isInstalled");
    const mockedPlatform = mockGlobalValue(process, "platform");
    const mockConfigurationFolder = mockGlobalFunction(configuration, "folder");

    setup(() => {
        // Reset all mocks
        mockWindow.showWarningMessage.reset();
        mockWindow.showInformationMessage.reset();
        mockUtilities.execFile.reset();
        mockSwiftlyIsSupported.reset();
        mockSwiftlyIsInstalled.reset();
        mockGetWorkspaceFolder.reset();

        // Set up default mock behavior
        mockedPlatform.setValue("darwin"); // Supported platform
        mockSwiftlyIsSupported.returns(true);
        mockSwiftlyIsInstalled.resolves(false); // Swiftly not installed by default

        // Mock filesystem operations
        mockFS({
            "/workspace": {
                ".swift-version": "6.0.0",
            },
        });

        // Mock workspace folders
        mockWorkspaceFolders.setValue([
            {
                uri: vscode.Uri.file("/workspace"),
                name: "test-workspace",
                index: 0,
            },
        ] as any);

        // Mock getWorkspaceFolder
        mockGetWorkspaceFolder.returns({
            uri: vscode.Uri.file("/workspace"),
            name: "test-workspace",
            index: 0,
        } as any);
    });

    activateExtensionForSuite({
        testAssets: ["versioned"],
    });

    teardown(() => {
        mockFS.restore();
    });

    suite("enabled prompt", () => {
        test("prompts to install swiftly when it is not installed and prompt is enabled", async function () {
            // Set up configuration to enable the prompt
            mockConfigurationFolder.returns({
                disableSwiftlyInstallPrompt: false,
                ignoreSwiftVersionFile: false,
            } as any);

            const mockLogger = mockObject<SwiftLogger>({
                error: mockFn(),
            });

            // Mock the warning message response
            mockWindow.showWarningMessage.resolves("Don't Show Again" as any);

            // Call the function under test
            await checkForSwiftlyInstallation("extensionPath", {} as any, instance(mockLogger));

            // Verify that showWarningMessage was called with the expected message
            expect(mockWindow.showWarningMessage).to.have.been.calledOnce;
            expect(mockWindow.showWarningMessage).to.have.been.calledWith(
                "A .swift-version file was detected. Install Swiftly to automatically manage Swift toolchain versions for this project.",
                { modal: false },
                "Install Swiftly",
                "Don't Show Again"
            );
        });
    });

    suite("disabled prompt", () => {
        test("does not prompt to install swiftly when prompt is disabled", async () => {
            // Set up configuration to disable the prompt
            mockConfigurationFolder.returns({
                disableSwiftlyInstallPrompt: true,
                ignoreSwiftVersionFile: false,
            } as any);

            const mockLogger = mockObject<SwiftLogger>({
                debug: mockFn(),
            });

            // Call the function under test
            await checkForSwiftlyInstallation("extensionPath", {} as any, instance(mockLogger));

            // Verify that showWarningMessage was NOT called
            expect(mockWindow.showWarningMessage).to.not.have.been.called;

            // Verify that the logger was called with the suppression message
            expect(mockLogger.debug).to.have.been.calledWith(
                "Swiftly installation prompt is suppressed"
            );
        });

        test("does not prompt to install swiftly when ignoring swift version files", async () => {
            // Set up configuration to ignore swift version files
            mockConfigurationFolder.returns({
                disableSwiftlyInstallPrompt: false,
                ignoreSwiftVersionFile: true,
            } as any);

            const mockLogger = mockObject<SwiftLogger>({
                debug: mockFn(),
            });

            // Call the function under test
            await checkForSwiftlyInstallation("extensionPath", {} as any, instance(mockLogger));

            // Verify that showWarningMessage was NOT called
            expect(mockWindow.showWarningMessage).to.not.have.been.called;

            // Verify that the logger was called with the suppression message
            expect(mockLogger.debug).to.have.been.calledWith(
                "Swiftly installation prompt is suppressed"
            );
        });

        test("does not prompt when swiftly is already installed", async () => {
            // Set up configuration to enable the prompt
            mockConfigurationFolder.returns({
                disableSwiftlyInstallPrompt: false,
                ignoreSwiftVersionFile: false,
            } as any);

            // Mock Swiftly as already installed
            mockSwiftlyIsInstalled.resolves(true);

            // Mock Swiftly version check
            mockUtilities.execFile.withArgs("swiftly", ["--version"]).resolves({
                stdout: "1.1.0\n",
                stderr: "",
            });

            const mockLogger = mockObject<SwiftLogger>({
                debug: mockFn(),
            });

            // Call the function under test
            await checkForSwiftlyInstallation("extensionPath", {} as any, instance(mockLogger));

            // Verify that showWarningMessage was NOT called since Swiftly is already installed
            expect(mockWindow.showWarningMessage).to.not.have.been.called;

            // Verify that the logger was called with the detection message
            expect(mockLogger.debug).to.have.been.calledWith("Detected Swiftly version 1.1.0.");
        });

        test("does not prompt on unsupported platform", async () => {
            // Set up configuration to enable the prompt
            mockConfigurationFolder.returns({
                disableSwiftlyInstallPrompt: false,
                ignoreSwiftVersionFile: false,
            } as any);

            // Mock unsupported platform
            mockSwiftlyIsSupported.returns(false);

            const mockLogger = mockObject<SwiftLogger>({
                debug: mockFn(),
            });

            // Call the function under test
            await checkForSwiftlyInstallation("extensionPath", {} as any, instance(mockLogger));

            // Verify that showWarningMessage was NOT called
            expect(mockWindow.showWarningMessage).to.not.have.been.called;

            // Verify that the logger was called with the platform message
            expect(mockLogger.debug).to.have.been.calledWith("Swiftly is not available on darwin");
        });
    });
});
