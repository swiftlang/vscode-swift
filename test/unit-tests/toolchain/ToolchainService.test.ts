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

// suite("findXcodeInstalls()", () => {
//     test("returns the list of Xcode installations found in the Spotlight index on macOS", async () => {
//         mockedEnv.platform = "darwin";
//         mockedUtilities.execFile.withArgs("mdfind").resolves({
//             stdout: "/Applications/Xcode.app\n/Applications/Xcode-beta.app\n",
//             stderr: "",
//         });
//         mockedUtilities.execFile
//             .withArgs("xcode-select", ["-p"])
//             .resolves({ stdout: "", stderr: "" });

//         const sortedXcodeInstalls = (await mockedtool.findXcodeInstalls()).sort();
//         expect(sortedXcodeInstalls).to.deep.equal([
//             "/Applications/Xcode-beta.app",
//             "/Applications/Xcode.app",
//         ]);
//     });

//     test("includes the currently selected Xcode installation on macOS", async () => {
//         mockedPlatform.setValue("darwin");
//         mockedUtilities.execFile.withArgs("mdfind").resolves({
//             stdout: "/Applications/Xcode-beta.app\n",
//             stderr: "",
//         });
//         mockedUtilities.execFile
//             .withArgs("xcode-select", ["-p"])
//             .resolves({ stdout: "/Applications/Xcode.app\n", stderr: "" });

//         const sortedXcodeInstalls = (await SwiftToolchain.findXcodeInstalls()).sort();
//         expect(sortedXcodeInstalls).to.deep.equal([
//             "/Applications/Xcode-beta.app",
//             "/Applications/Xcode.app",
//         ]);
//     });

//     test("does not duplicate the currently selected Xcode installation on macOS", async () => {
//         mockedPlatform.setValue("darwin");
//         mockedUtilities.execFile.withArgs("mdfind").resolves({
//             stdout: "/Applications/Xcode.app\n/Applications/Xcode-beta.app\n",
//             stderr: "",
//         });
//         mockedUtilities.execFile
//             .withArgs("xcode-select", ["-p"])
//             .resolves({ stdout: "/Applications/Xcode.app\n", stderr: "" });

//         const sortedXcodeInstalls = (await SwiftToolchain.findXcodeInstalls()).sort();
//         expect(sortedXcodeInstalls).to.deep.equal([
//             "/Applications/Xcode-beta.app",
//             "/Applications/Xcode.app",
//         ]);
//     });

//     test("returns an empty array on non-macOS platforms", async () => {
//         mockedPlatform.setValue("linux");
//         await expect(SwiftToolchain.findXcodeInstalls()).to.eventually.be.empty;

//         mockedPlatform.setValue("win32");
//         await expect(SwiftToolchain.findXcodeInstalls()).to.eventually.be.empty;
//     });
// });
