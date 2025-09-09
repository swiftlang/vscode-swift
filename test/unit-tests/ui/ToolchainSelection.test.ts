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
import * as mockFS from "mock-fs";
import * as sinon from "sinon";
import { match, stub } from "sinon";
import * as vscode from "vscode";

import { SwiftLogger } from "@src/logging/SwiftLogger";
import { Swiftly } from "@src/toolchain/swiftly";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import * as ToolchainSelectionModule from "@src/ui/ToolchainSelection";
import * as utilities from "@src/utilities/utilities";
import { Version } from "@src/utilities/version";

import { mockGlobalModule, mockGlobalObject, mockGlobalValue } from "../../MockUtils";

suite("ToolchainSelection Unit Test Suite", () => {
    const mockedUtilities = mockGlobalModule(utilities);
    const mockedPlatform = mockGlobalValue(process, "platform");
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");
    const mockedVSCodeCommands = mockGlobalObject(vscode, "commands");
    const mockedVSCodeEnv = mockGlobalObject(vscode, "env");
    const mockedVSCodeWorkspace = mockGlobalObject(vscode, "workspace");
    let mockLogger: SwiftLogger;

    setup(() => {
        mockFS({});
        mockedUtilities.execFile.reset();
        mockedPlatform.setValue("darwin");

        mockLogger = {
            info: () => {},
            warn: () => {},
            error: () => {},
        } as unknown as SwiftLogger;

        // Set up VSCode mocks
        mockedVSCodeWindow.showQuickPick.resolves(undefined);
        mockedVSCodeWindow.showOpenDialog.resolves(undefined);
        mockedVSCodeWindow.showErrorMessage.resolves(undefined);
        mockedVSCodeWindow.showWarningMessage.resolves(undefined);
        mockedVSCodeWindow.showInformationMessage.resolves(undefined);
        mockedVSCodeWindow.withProgress.callsFake(async (_options, task) => {
            return await task({ report: () => {} }, {} as any);
        });
        mockedVSCodeCommands.executeCommand.resolves(undefined);
        mockedVSCodeEnv.openExternal.resolves(true);

        // Mock workspace configuration to prevent actual settings writes
        const mockConfiguration = {
            update: stub().resolves(),
            inspect: stub().returns({}),
            get: stub().returns(undefined),
            has: stub().returns(false),
        };
        mockedVSCodeWorkspace.getConfiguration.returns(mockConfiguration);

        // Mock SwiftToolchain static methods
        stub(SwiftToolchain, "findXcodeInstalls").resolves([]);
        stub(SwiftToolchain, "getToolchainInstalls").resolves([]);
        stub(SwiftToolchain, "getXcodeDeveloperDir").resolves("");

        // Mock Swiftly static methods
        stub(Swiftly, "listAvailableToolchains").resolves([]);
        stub(Swiftly, "listAvailable").resolves([]);
        stub(Swiftly, "inUseVersion").resolves(undefined);
        stub(Swiftly, "use").resolves();
        stub(Swiftly, "installToolchain").resolves();
    });

    teardown(() => {
        mockFS.restore();
        sinon.restore();
    });

    suite("showToolchainSelectionQuickPick", () => {
        function createMockActiveToolchain(options: {
            swiftVersion: Version;
            toolchainPath: string;
            swiftFolderPath: string;
            isSwiftlyManaged?: boolean;
        }): SwiftToolchain {
            return {
                swiftVersion: options.swiftVersion,
                toolchainPath: options.toolchainPath,
                swiftFolderPath: options.swiftFolderPath,
                isSwiftlyManaged: options.isSwiftlyManaged || false,
            } as SwiftToolchain;
        }

        test("should show quick pick with toolchain options", async () => {
            const xcodeInstalls = ["/Applications/Xcode.app"];
            const toolchainInstalls = [
                "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain",
            ];
            const swiftlyToolchains = ["swift-6.0.0"];
            const availableToolchains = [
                {
                    name: "6.0.1",
                    type: "stable" as const,
                    version: "6.0.1",
                    isInstalled: false,
                },
            ];

            (SwiftToolchain.findXcodeInstalls as sinon.SinonStub).resolves(xcodeInstalls);
            (SwiftToolchain.getToolchainInstalls as sinon.SinonStub).resolves(toolchainInstalls);
            (Swiftly.listAvailableToolchains as sinon.SinonStub).resolves(swiftlyToolchains);
            (Swiftly.listAvailable as sinon.SinonStub).resolves(availableToolchains);

            await ToolchainSelectionModule.showToolchainSelectionQuickPick(undefined, mockLogger);

            expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
            expect(SwiftToolchain.findXcodeInstalls).to.have.been.called;
            expect(SwiftToolchain.getToolchainInstalls).to.have.been.called;
            expect(Swiftly.listAvailableToolchains).to.have.been.called;
        });

        test("should work on Linux platform", async () => {
            mockedPlatform.setValue("linux");

            (SwiftToolchain.findXcodeInstalls as sinon.SinonStub).resolves([]);
            (SwiftToolchain.getToolchainInstalls as sinon.SinonStub).resolves([]);
            (Swiftly.listAvailableToolchains as sinon.SinonStub).resolves([]);
            (Swiftly.listAvailable as sinon.SinonStub).resolves([]);

            await ToolchainSelectionModule.showToolchainSelectionQuickPick(undefined, mockLogger);

            expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
            expect(SwiftToolchain.getToolchainInstalls).to.have.been.called;
            expect(Swiftly.listAvailableToolchains).to.have.been.called;
        });

        test("should handle active toolchain correctly", async () => {
            const activeToolchain = createMockActiveToolchain({
                swiftVersion: new Version(6, 0, 1),
                toolchainPath: "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr",
                swiftFolderPath:
                    "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin",
                isSwiftlyManaged: false,
            });

            const toolchainInstalls = [
                "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain",
            ];

            (SwiftToolchain.findXcodeInstalls as sinon.SinonStub).resolves([]);
            (SwiftToolchain.getToolchainInstalls as sinon.SinonStub).resolves(toolchainInstalls);
            (Swiftly.listAvailableToolchains as sinon.SinonStub).resolves([]);
            (Swiftly.listAvailable as sinon.SinonStub).resolves([]);

            await ToolchainSelectionModule.showToolchainSelectionQuickPick(
                activeToolchain,
                mockLogger
            );

            expect(SwiftToolchain.getToolchainInstalls).to.have.been.called;
        });

        test("should handle Swiftly managed active toolchain", async () => {
            const activeToolchain = createMockActiveToolchain({
                swiftVersion: new Version(6, 0, 0),
                toolchainPath: "/home/user/.swiftly/toolchains/swift-6.0.0/usr",
                swiftFolderPath: "/home/user/.swiftly/toolchains/swift-6.0.0/usr/bin",
                isSwiftlyManaged: true,
            });

            const swiftlyToolchains = ["6.0.0", "6.1.0"];

            (SwiftToolchain.findXcodeInstalls as sinon.SinonStub).resolves([]);
            (SwiftToolchain.getToolchainInstalls as sinon.SinonStub).resolves([]);
            (Swiftly.listAvailableToolchains as sinon.SinonStub).resolves(swiftlyToolchains);
            (Swiftly.listAvailable as sinon.SinonStub).resolves([]);
            (Swiftly.inUseVersion as sinon.SinonStub).resolves("6.0.0");

            await ToolchainSelectionModule.showToolchainSelectionQuickPick(
                activeToolchain,
                mockLogger
            );

            expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
        });

        test("should handle toolchain installation selection", async () => {
            const installableToolchain = {
                type: "toolchain",
                category: "installable",
                label: "$(cloud-download) 6.0.1 (stable)",
                version: "6.0.1",
                toolchainType: "stable",
                onDidSelect: stub().resolves(),
            };

            mockedVSCodeWindow.showQuickPick.resolves(installableToolchain as any);

            (SwiftToolchain.findXcodeInstalls as sinon.SinonStub).resolves([]);
            (SwiftToolchain.getToolchainInstalls as sinon.SinonStub).resolves([]);
            (Swiftly.listAvailableToolchains as sinon.SinonStub).resolves([]);
            (Swiftly.listAvailable as sinon.SinonStub).resolves([
                {
                    name: "6.0.1",
                    type: "stable" as const,
                    version: "6.0.1",
                    isInstalled: false,
                },
            ]);

            await ToolchainSelectionModule.showToolchainSelectionQuickPick(undefined, mockLogger);

            expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
        });

        test("should handle action item selection", async () => {
            const actionItem = {
                type: "action",
                label: "$(cloud-download) Download from Swift.org...",
                run: stub().resolves(),
            };

            mockedVSCodeWindow.showQuickPick.resolves(actionItem as any);

            (SwiftToolchain.findXcodeInstalls as sinon.SinonStub).resolves([]);
            (SwiftToolchain.getToolchainInstalls as sinon.SinonStub).resolves([]);
            (Swiftly.listAvailableToolchains as sinon.SinonStub).resolves([]);
            (Swiftly.listAvailable as sinon.SinonStub).resolves([]);

            await ToolchainSelectionModule.showToolchainSelectionQuickPick(undefined, mockLogger);

            expect(actionItem.run).to.have.been.called;
        });

        test("should handle user cancellation", async () => {
            mockedVSCodeWindow.showQuickPick.resolves(undefined);

            (SwiftToolchain.findXcodeInstalls as sinon.SinonStub).resolves([]);
            (SwiftToolchain.getToolchainInstalls as sinon.SinonStub).resolves([]);
            (Swiftly.listAvailableToolchains as sinon.SinonStub).resolves([]);
            (Swiftly.listAvailable as sinon.SinonStub).resolves([]);

            await ToolchainSelectionModule.showToolchainSelectionQuickPick(undefined, mockLogger);

            // Should complete without error when user cancels
            expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
        });

        test("should handle errors gracefully", async () => {
            (SwiftToolchain.findXcodeInstalls as sinon.SinonStub).rejects(
                new Error("Xcode search failed")
            );
            (SwiftToolchain.getToolchainInstalls as sinon.SinonStub).rejects(
                new Error("Toolchain search failed")
            );
            (Swiftly.listAvailableToolchains as sinon.SinonStub).rejects(
                new Error("Swiftly list failed")
            );
            (Swiftly.listAvailable as sinon.SinonStub).rejects(
                new Error("Swiftly available failed")
            );

            await ToolchainSelectionModule.showToolchainSelectionQuickPick(undefined, mockLogger);

            expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
        });
    });

    suite("downloadToolchain", () => {
        test("should open external URL for Swift.org", async () => {
            mockedVSCodeEnv.openExternal.resolves(true);

            await ToolchainSelectionModule.downloadToolchain();

            expect(mockedVSCodeEnv.openExternal).to.have.been.calledWith(
                match((uri: vscode.Uri) => uri.toString() === "https://www.swift.org/install")
            );
        });
    });

    suite("installSwiftly", () => {
        test("should open external URL for Swiftly installation", async () => {
            mockedVSCodeEnv.openExternal.resolves(true);

            await ToolchainSelectionModule.installSwiftly();

            expect(mockedVSCodeEnv.openExternal).to.have.been.calledWith(
                match((uri: vscode.Uri) => uri.toString() === "https://www.swift.org/install/")
            );
        });
    });

    suite("selectToolchainFolder", () => {
        test("should show open dialog for folder selection", async () => {
            const selectedFolder = [{ fsPath: "/custom/toolchain/path" }] as vscode.Uri[];
            mockedVSCodeWindow.showOpenDialog.resolves(selectedFolder);

            await ToolchainSelectionModule.selectToolchainFolder();

            expect(mockedVSCodeWindow.showOpenDialog).to.have.been.calledWith({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: "Select the folder containing Swift binaries",
                openLabel: "Select folder",
            });
        });

        test("should handle user cancellation", async () => {
            mockedVSCodeWindow.showOpenDialog.resolves(undefined);

            await ToolchainSelectionModule.selectToolchainFolder();

            expect(mockedVSCodeWindow.showOpenDialog).to.have.been.called;
        });
    });
});
