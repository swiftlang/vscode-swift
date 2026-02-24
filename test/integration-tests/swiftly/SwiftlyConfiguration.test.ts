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
import * as fs from "fs/promises";
import * as vscode from "vscode";

import configuration from "@src/configuration";
import { checkForSwiftlyInstallation } from "@src/extension";
import { SwiftLogger } from "@src/logging/SwiftLogger";
import { Swiftly } from "@src/toolchain/swiftly";
import * as filesystem from "@src/utilities/filesystem";
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

suite("Swiftly Configuration Tests", () => {
    const mockWindow = mockGlobalObject(vscode, "window");
    const mockPlatform = mockGlobalValue(process, "platform");
    const mockSwiftlyIsInstalled = mockGlobalFunction(Swiftly, "isInstalled");
    const mockConfigurationFolder = mockGlobalFunction(configuration, "folder");
    const mockGlobDirectory = mockGlobalFunction(filesystem, "globDirectory");
    const mockUtilities = mockGlobalModule(utilities);
    const mockFsReadFile = mockGlobalFunction(fs, "readFile");

    setup(() => {
        mockPlatform.setValue("darwin");
        mockSwiftlyIsInstalled.resolves(false); // Swiftly not installed by default

        // Mock globDirectory to return the .swift-version file by default
        mockGlobDirectory.resolves(["/workspace/.swift-version"]);

        // Mock fs.readFile to return the content of .swift-version file
        mockFsReadFile.resolves("6.0.0");
    });

    suite("enabled prompt", () => {
        test("prompts to install swiftly when it is not installed and prompt is enabled", async function () {
            mockConfigurationFolder.returns({
                disableSwiftlyInstallPrompt: false,
                ignoreSwiftVersionFile: false,
            } as any);

            const mockLogger = mockObject<SwiftLogger>({
                error: mockFn(),
                debug: mockFn(),
            });

            mockWindow.showWarningMessage.resolves("Don't Show Again" as any);

            await checkForSwiftlyInstallation("extensionPath", {} as any, instance(mockLogger));

            // Verify that showWarningMessage was called with the expected message
            expect(mockWindow.showWarningMessage).to.have.been.calledOnceWith(
                "A .swift-version file was detected. Install Swiftly to automatically manage Swift toolchain versions for this project.",
                { modal: false },
                "Install Swiftly",
                "Don't Show Again"
            );
        });
    });

    suite("disabled prompt", () => {
        test("does not prompt to install swiftly when prompt is disabled", async () => {
            mockConfigurationFolder.returns({
                disableSwiftlyInstallPrompt: true,
                ignoreSwiftVersionFile: false,
            } as any);

            const mockLogger = mockObject<SwiftLogger>({
                debug: mockFn(),
            });

            await checkForSwiftlyInstallation("extensionPath", {} as any, instance(mockLogger));

            // Verify that showWarningMessage was NOT called
            expect(mockWindow.showWarningMessage).to.not.have.been.called;

            // Verify that the logger was called with the suppression message
            expect(mockLogger.debug).to.have.been.calledWith(
                "Swiftly installation prompt is suppressed"
            );
        });

        test("does not prompt to install swiftly when ignoring swift version files", async () => {
            mockConfigurationFolder.returns({
                disableSwiftlyInstallPrompt: false,
                ignoreSwiftVersionFile: true,
            } as any);

            const mockLogger = mockObject<SwiftLogger>({
                debug: mockFn(),
            });

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

            mockSwiftlyIsInstalled.resolves(true);
            mockUtilities.execFile.withArgs("swiftly", ["--version"]).resolves({
                stdout: "1.1.0\n",
                stderr: "",
            });

            const mockLogger = mockObject<SwiftLogger>({
                debug: mockFn(),
            });

            await checkForSwiftlyInstallation("extensionPath", {} as any, instance(mockLogger));

            // Verify that showWarningMessage was NOT called since Swiftly is already installed
            expect(mockWindow.showWarningMessage).to.not.have.been.called;

            // Verify that the logger was called with the detection message
            expect(mockLogger.debug).to.have.been.calledWith("Detected Swiftly version 1.1.0.");
        });

        test("does not prompt on unsupported platform", async () => {
            mockPlatform.setValue("win32");
            mockConfigurationFolder.returns({
                disableSwiftlyInstallPrompt: false,
                ignoreSwiftVersionFile: false,
            } as any);

            const mockLogger = mockObject<SwiftLogger>({
                debug: mockFn(),
            });

            await checkForSwiftlyInstallation("extensionPath", {} as any, instance(mockLogger));

            // Verify that showWarningMessage was NOT called
            expect(mockWindow.showWarningMessage).to.not.have.been.called;

            // Verify that the logger was called with the platform message
            expect(mockLogger.debug).to.have.been.calledWith("Swiftly is not available on win32");
        });

        test("does not prompt when no .swift-version files are found", async () => {
            mockConfigurationFolder.returns({
                disableSwiftlyInstallPrompt: false,
                ignoreSwiftVersionFile: false,
            } as any);

            // Mock no .swift-version files found
            mockGlobDirectory.resolves([]);

            const mockLogger = mockObject<SwiftLogger>({
                debug: mockFn(),
            });

            await checkForSwiftlyInstallation("extensionPath", {} as any, instance(mockLogger));

            // Verify that showWarningMessage was NOT called since no .swift-version files were found
            expect(mockWindow.showWarningMessage).to.not.have.been.called;
        });
    });
});
