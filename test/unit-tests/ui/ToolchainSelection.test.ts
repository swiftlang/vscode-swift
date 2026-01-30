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
import * as path from "path";
import { match } from "sinon";
import * as vscode from "vscode";

import { SwiftLogger } from "@src/logging/SwiftLogger";
import { Swiftly } from "@src/toolchain/swiftly";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { showToolchainSelectionQuickPick } from "@src/ui/ToolchainSelection";
import * as utilities from "@src/utilities/utilities";

import {
    MockedObject,
    instance,
    mockFn,
    mockGlobalModule,
    mockGlobalObject,
    mockGlobalValue,
    mockObject,
} from "../../MockUtils";

suite("ToolchainSelection Unit Test Suite", () => {
    const mockedUtilities = mockGlobalModule(utilities);
    const mockedPlatform = mockGlobalValue(process, "platform");
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");
    const mockedVSCodeCommands = mockGlobalObject(vscode, "commands");
    const mockedVSCodeEnv = mockGlobalObject(vscode, "env");
    const mockedVSCodeWorkspace = mockGlobalObject(vscode, "workspace");
    const mockedSwiftToolchain = mockGlobalModule(SwiftToolchain);
    let mockedSwiftly: MockedObject<Swiftly>;
    let mockedConfiguration: MockedObject<vscode.WorkspaceConfiguration>;
    let mockedLogger: MockedObject<SwiftLogger>;

    setup(() => {
        mockFS({});
        mockedUtilities.execFile.rejects(
            new Error("execFile was not properly mocked for this test.")
        );

        mockedLogger = mockObject<SwiftLogger>({});

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
        mockedConfiguration = mockObject<vscode.WorkspaceConfiguration>({
            update: mockFn(),
            inspect: mockFn(s => s.returns({})),
            get: mockFn(s => {
                // Return appropriate defaults for configuration properties
                s.withArgs("path", match.any).returns("");
                s.withArgs("runtimePath", match.any).returns("");
                s.withArgs("swiftEnvironmentVariables", match.any).returns({});
                // Default fallback
                s.returns(undefined);
            }),
            has: mockFn(s => s.returns(false)),
        });
        mockedVSCodeWorkspace.getConfiguration.returns(instance(mockedConfiguration));
        mockedVSCodeWorkspace.workspaceFolders = [
            {
                index: 0,
                name: "test",
                uri: vscode.Uri.file("/path/to/workspace"),
            },
        ];

        // Mock SwiftToolchain static methods
        mockedSwiftToolchain.findXcodeInstalls.resolves([]);
        mockedSwiftToolchain.getToolchainInstalls.resolves([]);
        mockedSwiftToolchain.getXcodeDeveloperDir.resolves("");

        // Mock Swiftly
        mockedSwiftly = mockObject<Swiftly>({
            list: mockFn(s => s.resolves([])),
            listAvailable: mockFn(s => s.resolves([])),
            inUseVersion: mockFn(s => s.resolves(undefined)),
            use: mockFn(s => s.resolves()),
            installToolchain: mockFn(s => s.resolves()),
        });
    });

    teardown(() => {
        mockFS.restore();
    });

    suite("macOS", () => {
        setup(() => {
            mockedPlatform.setValue("darwin");
        });

        test("shows Xcode toolchains", async () => {
            mockedSwiftToolchain.findXcodeInstalls.resolves([
                "/Applications/Xcode-beta.app",
                "/Applications/Xcode.app",
            ]);
            // Extract the Xcode toolchain labels and simulate user cancellation
            let xcodeToolchains: string[] = [];
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Select the Swift toolchain"))
                .callsFake(async items => {
                    xcodeToolchains = (await items)
                        .filter((t: any) => t.category === "xcode")
                        .map((t: any) => t.label);
                    return undefined;
                });

            await showToolchainSelectionQuickPick(
                undefined,
                instance(mockedSwiftly),
                instance(mockedLogger)
            );

            expect(xcodeToolchains).to.deep.equal(["Xcode", "Xcode-beta"]);
        });

        test("user is able to set an Xcode toolchain for their workspace", async () => {
            mockedSwiftToolchain.findXcodeInstalls.resolves(["/Applications/Xcode.app"]);
            // User selects the first toolchain that appears
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Select the Swift toolchain"))
                .callsFake(async items => {
                    const xcodeToolchains = (await items).filter(
                        (t: any) => t.category === "xcode"
                    );
                    return xcodeToolchains[0];
                });
            // User selects Workspace Configuration
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Toolchain Configuration"))
                .callsFake(async items => {
                    return (await items).find(item => item.label === "Workspace Configuration");
                });

            await showToolchainSelectionQuickPick(
                undefined,
                instance(mockedSwiftly),
                instance(mockedLogger)
            );

            expect(mockedConfiguration.update).to.have.been.calledWith(
                "path",
                path.normalize(
                    "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin"
                ),
                vscode.ConfigurationTarget.Workspace
            );
        });

        test("user is able to set a global Xcode toolchain", async () => {
            mockedSwiftToolchain.findXcodeInstalls.resolves(["/Applications/Xcode.app"]);
            // User selects the first toolchain that appears
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Select the Swift toolchain"))
                .callsFake(async items => {
                    const xcodeToolchains = (await items).filter(
                        (t: any) => t.category === "xcode"
                    );
                    return xcodeToolchains[0];
                });
            // User selects Global Configuration
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Toolchain Configuration"))
                .callsFake(async items => {
                    return (await items).find(item => item.label === "Global Configuration");
                });

            await showToolchainSelectionQuickPick(
                undefined,
                instance(mockedSwiftly),
                instance(mockedLogger)
            );

            expect(mockedConfiguration.update).to.have.been.calledWith(
                "path",
                path.normalize(
                    "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin"
                ),
                vscode.ConfigurationTarget.Global
            );
        });

        test("shows public toolchains installed by the user", async () => {
            mockedSwiftToolchain.getToolchainInstalls.resolves([
                "/Library/Developer/Toolchains/swift-main-DEVELOPMENT",
                "/Library/Developer/Toolchains/swift-6.2-RELEASE",
            ]);
            // Extract the Xcode toolchain labels and simulate user cancellation
            let publicToolchains: string[] = [];
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Select the Swift toolchain"))
                .callsFake(async items => {
                    publicToolchains = (await items)
                        .filter((t: any) => t.category === "public")
                        .map((t: any) => t.label);
                    return undefined;
                });

            await showToolchainSelectionQuickPick(
                undefined,
                instance(mockedSwiftly),
                instance(mockedLogger)
            );

            expect(publicToolchains).to.deep.equal(["swift-main-DEVELOPMENT", "swift-6.2-RELEASE"]);
        });

        test("shows toolchains installed via Swiftly", async () => {
            mockedSwiftly.list.resolves(["6.2.0", "6.0.0", "5.9.3"]);
            // Extract the Swiftly toolchain labels and simulate user cancellation
            let swiftlyToolchains: string[] = [];
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Select the Swift toolchain"))
                .callsFake(async items => {
                    swiftlyToolchains = (await items)
                        .filter((t: any) => t.category === "swiftly")
                        .map((t: any) => t.label);
                    return undefined;
                });

            await showToolchainSelectionQuickPick(
                undefined,
                instance(mockedSwiftly),
                instance(mockedLogger)
            );

            expect(swiftlyToolchains).to.deep.equal(["6.2.0", "6.0.0", "5.9.3"]);
        });

        test("user is able to set a Swiftly toolchain for their workspace", async () => {
            mockedSwiftly.list.resolves(["6.2.0"]);
            mockedSwiftToolchain.findXcodeInstalls.resolves(["/Applications/Xcode.app"]);
            // User selects the first toolchain that appears
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Select the Swift toolchain"))
                .callsFake(async items => {
                    const swiftlyToolchains = (await items).filter(
                        (t: any) => t.category === "swiftly"
                    );
                    return swiftlyToolchains[0];
                });
            // User selects Workspace Configuration
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Toolchain Configuration"))
                .callsFake(async items => {
                    return (await items).find(item => item.label === "Workspace Configuration");
                });

            await showToolchainSelectionQuickPick(
                undefined,
                instance(mockedSwiftly),
                instance(mockedLogger)
            );

            expect(mockedSwiftly.use).to.have.been.calledWith(
                "6.2.0",
                path.normalize("/path/to/workspace")
            );
            expect(mockedConfiguration.update).to.have.been.calledWith(
                "path",
                undefined,
                vscode.ConfigurationTarget.Workspace
            );
        });

        test("user is able to set a global Swiftly toolchain", async () => {
            mockedSwiftly.list.resolves(["6.2.0"]);
            mockedSwiftToolchain.findXcodeInstalls.resolves(["/Applications/Xcode.app"]);
            mockedVSCodeWorkspace.workspaceFolders = [
                {
                    index: 0,
                    name: "test",
                    uri: vscode.Uri.file("/path/to/workspace"),
                },
            ];
            // User selects the first toolchain that appears
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Select the Swift toolchain"))
                .callsFake(async items => {
                    const swiftlyToolchains = (await items).filter(
                        (t: any) => t.category === "swiftly"
                    );
                    return swiftlyToolchains[0];
                });
            // User selects Global Configuration
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Toolchain Configuration"))
                .callsFake(async items => {
                    return (await items).find(item => item.label === "Global Configuration");
                });

            await showToolchainSelectionQuickPick(
                undefined,
                instance(mockedSwiftly),
                instance(mockedLogger)
            );

            expect(mockedSwiftly.use).to.have.been.calledWith("6.2.0");
            expect(mockedConfiguration.update).to.have.been.calledWith(
                "path",
                undefined,
                vscode.ConfigurationTarget.Global
            );
        });
    });

    suite("Linux", () => {
        setup(() => {
            mockedPlatform.setValue("linux");
        });

        test("shows toolchains installed via Swiftly", async () => {
            mockedSwiftly.list.resolves(["6.2.0", "6.0.0", "5.9.3"]);
            // Extract the Swiftly toolchain labels and simulate user cancellation
            let swiftlyToolchains: string[] = [];
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Select the Swift toolchain"))
                .callsFake(async items => {
                    swiftlyToolchains = (await items)
                        .filter((t: any) => t.category === "swiftly")
                        .map((t: any) => t.label);
                    return undefined;
                });

            await showToolchainSelectionQuickPick(
                undefined,
                instance(mockedSwiftly),
                instance(mockedLogger)
            );

            expect(swiftlyToolchains).to.deep.equal(["6.2.0", "6.0.0", "5.9.3"]);
        });

        test("user is able to set a Swiftly toolchain for their workspace", async () => {
            mockedSwiftly.list.resolves(["6.2.0"]);
            // User selects the first toolchain that appears
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Select the Swift toolchain"))
                .callsFake(async items => {
                    const swiftlyToolchains = (await items).filter(
                        (t: any) => t.category === "swiftly"
                    );
                    return swiftlyToolchains[0];
                });
            // User selects Workspace Configuration
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Toolchain Configuration"))
                .callsFake(async items => {
                    return (await items).find(item => item.label === "Workspace Configuration");
                });

            await showToolchainSelectionQuickPick(
                undefined,
                instance(mockedSwiftly),
                instance(mockedLogger)
            );

            expect(mockedSwiftly.use).to.have.been.calledWith(
                "6.2.0",
                path.normalize("/path/to/workspace")
            );
            expect(mockedConfiguration.update).to.have.been.calledWith(
                "path",
                undefined,
                vscode.ConfigurationTarget.Workspace
            );
        });

        test("user is able to set a global Swiftly toolchain", async () => {
            mockedSwiftly.list.resolves(["6.2.0"]);
            mockedVSCodeWorkspace.workspaceFolders = [
                {
                    index: 0,
                    name: "test",
                    uri: vscode.Uri.file("/path/to/workspace"),
                },
            ];
            // User selects the first toolchain that appears
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Select the Swift toolchain"))
                .callsFake(async items => {
                    const swiftlyToolchains = (await items).filter(
                        (t: any) => t.category === "swiftly"
                    );
                    return swiftlyToolchains[0];
                });
            // User selects Global Configuration
            mockedVSCodeWindow.showQuickPick
                .withArgs(match.any, match.has("title", "Toolchain Configuration"))
                .callsFake(async items => {
                    return (await items).find(item => item.label === "Global Configuration");
                });

            await showToolchainSelectionQuickPick(
                undefined,
                instance(mockedSwiftly),
                instance(mockedLogger)
            );

            expect(mockedSwiftly.use).to.have.been.calledWith("6.2.0");
            expect(mockedConfiguration.update).to.have.been.calledWith(
                "path",
                undefined,
                vscode.ConfigurationTarget.Global
            );
        });
    });
});
