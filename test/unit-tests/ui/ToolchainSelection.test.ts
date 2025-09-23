// // //===----------------------------------------------------------------------===//
// // //
// // // This source file is part of the VS Code Swift open source project
// // //
// // // Copyright (c) 2025 the VS Code Swift project authors
// // // Licensed under Apache License v2.0
// // //
// // // See LICENSE.txt for license information
// // // See CONTRIBUTORS.txt for the list of VS Code Swift project authors
// // //
// // // SPDX-License-Identifier: Apache-2.0
// // //
// // //===----------------------------------------------------------------------===//
// import { expect } from "chai";
// import * as mockFS from "mock-fs";
// import { match, stub } from "sinon";
// import * as vscode from "vscode";

// import { Environment } from "@src/services/Environment";
// import { Swiftly } from "@src/swiftly/Swiftly";
// import { SwiftlyError } from "@src/swiftly/SwiftlyError";
// import { AvailableToolchain } from "@src/swiftly/types";
// import { SwiftToolchain } from "@src/toolchain/SwiftToolchain";
// import { ToolchainService } from "@src/toolchain/ToolchainService";
// import {
//     downloadToolchain,
//     installSwiftly,
//     selectToolchainFolder,
//     showToolchainSelectionQuickPick,
// } from "@src/ui/ToolchainSelection";
// import { Result } from "@src/utilities/result";
// import { Version } from "@src/utilities/version";

// import { MockedObject, mockFn, mockGlobalObject, mockObject } from "../../MockUtils";

// suite("ToolchainSelection Unit Test Suite", () => {
//     const mockedVSCodeEnv = mockGlobalObject(vscode, "env");
//     const mockedVSCodeWindow = mockGlobalObject(vscode, "window");
//     const mockedVSCodeWorkspace = mockGlobalObject(vscode, "workspace");
//     let mockedEnvironment: MockedObject<Environment>;
//     let mockedToolchainService: MockedObject<ToolchainService>;
//     let mockedSwiftly: MockedObject<Swiftly>;

//     setup(() => {
//         mockedEnvironment = mockObject<Environment>({ platform: "darwin" });
//         mockedToolchainService = mockObject<ToolchainService>({
//             findXcodeInstalls: mockFn(),
//             getToolchainInstalls: mockFn(),
//         });
//         mockedSwiftly = mockObject<Swiftly>({
//             getActiveToolchain: mockFn(),
//             getInstalledToolchains: mockFn(),
//             getAvailableToolchains: mockFn(),
//         });
//         // Mock workspace configuration to prevent actual settings writes
//         const mockConfiguration = {
//             update: stub().resolves(),
//             inspect: stub().returns({}),
//             get: stub().returns(undefined),
//             has: stub().returns(false),
//         };
//         mockedVSCodeWorkspace.getConfiguration.returns(mockConfiguration);
//     });

//     teardown(() => {
//         mockFS.restore();
//     });

//     suite("showToolchainSelectionQuickPick", () => {
//         function createMockActiveToolchain(options: {
//             swiftVersion: Version;
//             toolchainPath: string;
//             swiftFolderPath: string;
//             isSwiftlyManaged?: boolean;
//         }): SwiftToolchain {
//             return {
//                 swiftVersion: options.swiftVersion,
//                 toolchainPath: options.toolchainPath,
//                 swiftFolderPath: options.swiftFolderPath,
//                 isSwiftlyManaged: options.isSwiftlyManaged || false,
//             } as SwiftToolchain;
//         }

//         test("should show quick pick with toolchain options", async () => {
//             const xcodeInstalls = ["/Applications/Xcode.app"];
//             const toolchainInstalls = [
//                 "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain",
//             ];
//             const swiftlyToolchains = ["swift-6.0.0"];
//             const availableToolchains: AvailableToolchain[] = [
//                 {
//                     installed: false,
//                     inUse: false,
//                     isDefault: false,
//                     version: {
//                         type: "stable",
//                         name: "6.0.1",
//                         major: 6,
//                         minor: 0,
//                         patch: 1,
//                     },
//                 },
//             ];

//             mockedToolchainService.findXcodeInstalls.resolves(xcodeInstalls);
//             mockedToolchainService.getToolchainInstalls.resolves(toolchainInstalls);
//             mockedSwiftly.getInstalledToolchains.resolves(Result.success(swiftlyToolchains));
//             mockedSwiftly.getAvailableToolchains.resolves(Result.success(availableToolchains));

//             await showToolchainSelectionQuickPick(
//                 undefined,
//                 mockedEnvironment,
//                 mockedToolchainService,
//                 mockedSwiftly,
//                 undefined
//             );

//             expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
//             expect(mockedToolchainService.findXcodeInstalls).to.have.been.called;
//             expect(mockedToolchainService.getToolchainInstalls).to.have.been.called;
//             expect(mockedSwiftly.getInstalledToolchains).to.have.been.called;
//         });

//         test("should work on Linux platform", async () => {
//             mockedEnvironment.platform = "linux";

//             await showToolchainSelectionQuickPick(
//                 undefined,
//                 mockedEnvironment,
//                 mockedToolchainService,
//                 mockedSwiftly,
//                 undefined
//             );

//             expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
//             expect(mockedToolchainService.getToolchainInstalls).to.have.been.called;
//             expect(mockedSwiftly.getInstalledToolchains).to.have.been.called;
//         });

//         test("should handle active toolchain correctly", async () => {
//             const activeToolchain = createMockActiveToolchain({
//                 swiftVersion: new Version(6, 0, 1),
//                 toolchainPath: "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr",
//                 swiftFolderPath:
//                     "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin",
//                 isSwiftlyManaged: false,
//             });

//             const toolchainInstalls = [
//                 "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain",
//             ];
//             mockedToolchainService.getToolchainInstalls.resolves(toolchainInstalls);

//             await showToolchainSelectionQuickPick(
//                 activeToolchain,
//                 mockedEnvironment,
//                 mockedToolchainService,
//                 mockedSwiftly,
//                 undefined
//             );

//             expect(mockedToolchainService.getToolchainInstalls).to.have.been.called;
//         });

//         test("should display Swiftly toolchains in a quick pick", async () => {
//             // GIVEN Swiftly.list() returns 6.0.0 and 6.1.0
//             //   AND Swiftly.inUseVersion() returns 6.0.0
//             //   AND the user cancels the quick pick dialog
//             mockedSwiftly.getInstalledToolchains.resolves(Result.success(["6.0.0", "6.1.0"]));
//             mockedSwiftly.getActiveToolchain.resolves(
//                 Result.success({ location: "", name: "6.0.0" })
//             );
//             mockedVSCodeWindow.showQuickPick.resolves(undefined);

//             // WHEN showToolchainSelectionQuickPick() is called
//             await showToolchainSelectionQuickPick(
//                 createMockActiveToolchain({
//                     swiftVersion: new Version(6, 0, 0),
//                     toolchainPath: "/home/user/.swiftly/toolchains/swift-6.0.0/usr",
//                     swiftFolderPath: "/home/user/.swiftly/toolchains/swift-6.0.0/usr/bin",
//                     isSwiftlyManaged: true,
//                 }),
//                 mockedEnvironment,
//                 mockedToolchainService,
//                 mockedSwiftly,
//                 undefined
//             );

//             // THEN a quick pick should display the Swiftly toolchains to the user
//             expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
//         });

//         test("should handle toolchain installation selection", async () => {
//             const installableToolchain = mockObject({
//                 type: "toolchain",
//                 category: "installable",
//                 label: "$(cloud-download) 6.0.1 (stable)",
//                 version: "6.0.1",
//                 toolchainType: "stable",
//                 onDidSelect: mockFn(s => s.resolves()),
//             });

//             mockedVSCodeWindow.showQuickPick.resolves(installableToolchain as any);

//             mockedToolchainService.findXcodeInstalls.resolves([]);
//             mockedToolchainService.getToolchainInstalls.resolves([]);
//             mockedSwiftly.getInstalledToolchains.resolves(Result.success([]));
//             mockedSwiftly.getAvailableToolchains.resolves(
//                 Result.success([
//                     {
//                         inUse: true,
//                         installed: true,
//                         isDefault: false,
//                         version: {
//                             type: "stable",
//                             name: "6.0.1",
//                             major: 6,
//                             minor: 0,
//                             patch: 1,
//                         },
//                     },
//                 ])
//             );

//             await showToolchainSelectionQuickPick(
//                 undefined,
//                 mockedEnvironment,
//                 mockedToolchainService,
//                 mockedSwiftly,
//                 undefined
//             );

//             expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
//         });

//         test("should handle action item selection", async () => {
//             const actionItem = {
//                 type: "action",
//                 label: "$(cloud-download) Download from Swift.org...",
//                 run: stub().resolves(),
//             };

//             mockedVSCodeWindow.showQuickPick.resolves(actionItem as any);

//             mockedToolchainService.findXcodeInstalls.resolves([]);
//             mockedToolchainService.getToolchainInstalls.resolves([]);
//             mockedSwiftly.getInstalledToolchains.resolves(Result.success([]));
//             mockedSwiftly.getAvailableToolchains.resolves(Result.success([]));

//             await showToolchainSelectionQuickPick(
//                 undefined,
//                 mockedEnvironment,
//                 mockedToolchainService,
//                 mockedSwiftly,
//                 undefined
//             );

//             expect(actionItem.run).to.have.been.called;
//         });

//         test("should handle user cancellation", async () => {
//             mockedVSCodeWindow.showQuickPick.resolves(undefined);

//             mockedToolchainService.findXcodeInstalls.resolves([]);
//             mockedToolchainService.getToolchainInstalls.resolves([]);
//             mockedSwiftly.getInstalledToolchains.resolves(Result.success([]));
//             mockedSwiftly.getAvailableToolchains.resolves(Result.success([]));

//             await showToolchainSelectionQuickPick(
//                 undefined,
//                 mockedEnvironment,
//                 mockedToolchainService,
//                 mockedSwiftly,
//                 undefined
//             );

//             // Should complete without error when user cancels
//             expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
//         });

//         test("should handle errors gracefully", async () => {
//             mockedToolchainService.findXcodeInstalls.rejects(new Error("Xcode search failed"));
//             mockedToolchainService.getToolchainInstalls.rejects(
//                 new Error("Toolchain search failed")
//             );
//             mockedSwiftly.getInstalledToolchains.rejects(Result.failure(SwiftlyError.unknown()));
//             mockedSwiftly.getAvailableToolchains.resolves(Result.failure(SwiftlyError.unknown()));

//             await showToolchainSelectionQuickPick(
//                 undefined,
//                 mockedEnvironment,
//                 mockedToolchainService,
//                 mockedSwiftly,
//                 undefined
//             );

//             expect(mockedVSCodeWindow.showQuickPick).to.have.been.called;
//         });
//     });

//     suite("downloadToolchain", () => {
//         test("should open external URL for Swift.org", async () => {
//             mockedVSCodeEnv.openExternal.resolves(true);

//             await downloadToolchain();

//             expect(mockedVSCodeEnv.openExternal).to.have.been.calledWith(
//                 match((uri: vscode.Uri) => uri.toString() === "https://www.swift.org/install")
//             );
//         });
//     });

//     suite("installSwiftly", () => {
//         test("should open external URL for Swiftly installation", async () => {
//             mockedVSCodeEnv.openExternal.resolves(true);

//             await installSwiftly();

//             expect(mockedVSCodeEnv.openExternal).to.have.been.calledWith(
//                 match((uri: vscode.Uri) => uri.toString() === "https://www.swift.org/install/")
//             );
//         });
//     });

//     suite("selectToolchainFolder", () => {
//         test("should show open dialog for folder selection", async () => {
//             const selectedFolder = [{ fsPath: "/custom/toolchain/path" }] as vscode.Uri[];
//             mockedVSCodeWindow.showOpenDialog.resolves(selectedFolder);

//             await selectToolchainFolder();

//             expect(mockedVSCodeWindow.showOpenDialog).to.have.been.calledWith({
//                 canSelectFiles: false,
//                 canSelectFolders: true,
//                 canSelectMany: false,
//                 title: "Select the folder containing Swift binaries",
//                 openLabel: "Select folder",
//             });
//         });

//         test("should handle user cancellation", async () => {
//             mockedVSCodeWindow.showOpenDialog.resolves(undefined);

//             await selectToolchainFolder();

//             expect(mockedVSCodeWindow.showOpenDialog).to.have.been.called;
//         });
//     });
// });
