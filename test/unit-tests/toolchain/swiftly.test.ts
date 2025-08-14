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
import * as os from "os";
import { match } from "sinon";
import { Swiftly } from "../../../src/toolchain/swiftly";
import * as utilities from "../../../src/utilities/utilities";
import * as shell from "../../../src/utilities/shell";
import { mockGlobalModule, mockGlobalValue } from "../../MockUtils";

suite.only("Swiftly Unit Tests", () => {
    const mockUtilities = mockGlobalModule(utilities);
    const mockShell = mockGlobalModule(shell);
    const mockedPlatform = mockGlobalValue(process, "platform");
    const mockedEnv = mockGlobalValue(process, "env");

    setup(() => {
        mockFS({});
        mockUtilities.execFile.reset();
        mockedPlatform.setValue("darwin");
        mockedEnv.setValue({});
    });

    teardown(() => {
        mockFS.restore();
    });

    suite("getSwiftlyToolchainInstalls", () => {
        test("should return toolchain names from list-available command for version 1.1.0", async () => {
            // Mock version check to return 1.1.0
            mockUtilities.execFile.withArgs("swiftly", ["--version"]).resolves({
                stdout: "1.1.0\n",
                stderr: "",
            });

            // Mock list-available command with JSON output
            const jsonOutput = {
                toolchains: [
                    {
                        inUse: true,
                        isDefault: true,
                        version: {
                            major: 5,
                            minor: 9,
                            patch: 0,
                            name: "swift-5.9.0-RELEASE",
                            type: "stable",
                        },
                    },
                    {
                        inUse: false,
                        isDefault: false,
                        version: {
                            major: 5,
                            minor: 8,
                            patch: 0,
                            name: "swift-5.8.0-RELEASE",
                            type: "stable",
                        },
                    },
                    {
                        inUse: false,
                        isDefault: false,
                        version: {
                            major: 5,
                            minor: 10,
                            branch: "development",
                            date: "2023-10-15",
                            name: "swift-DEVELOPMENT-SNAPSHOT-2023-10-15-a",
                            type: "snapshot",
                        },
                    },
                ],
            };

            mockUtilities.execFile.withArgs("swiftly", ["list", "--format=json"]).resolves({
                stdout: JSON.stringify(jsonOutput),
                stderr: "",
            });

            const result = await Swiftly.listAvailableToolchains();

            expect(result).to.deep.equal([
                "swift-5.9.0-RELEASE",
                "swift-5.8.0-RELEASE",
                "swift-DEVELOPMENT-SNAPSHOT-2023-10-15-a",
            ]);

            expect(mockUtilities.execFile).to.have.been.calledWith("swiftly", ["--version"]);
            expect(mockUtilities.execFile).to.have.been.calledWith("swiftly", [
                "list",
                "--format=json",
            ]);
        });

        test("should return empty array when platform is not supported", async () => {
            mockedPlatform.setValue("win32");

            const result = await Swiftly.listAvailableToolchains();

            expect(result).to.deep.equal([]);
            expect(mockUtilities.execFile).not.have.been.called;
        });
    });

    suite("installToolchain", () => {
        test("should throw error on unsupported platform", async () => {
            mockedPlatform.setValue("win32");

            await expect(
                Swiftly.installToolchain("6.0.0", undefined)
            ).to.eventually.be.rejectedWith("Swiftly is not supported on this platform");
            expect(mockUtilities.execFile).to.not.have.been.called;
        });

        test("should install toolchain successfully on macOS without progress callback", async () => {
            mockedPlatform.setValue("darwin");
            mockUtilities.execFile.withArgs("swiftly").resolves({ stdout: "", stderr: "" });

            const tmpDir = os.tmpdir();
            mockFS({
                [tmpDir]: {},
            });

            await Swiftly.installToolchain("6.0.0", undefined);

            expect(mockUtilities.execFile).to.have.been.calledWith("swiftly", [
                "install",
                "6.0.0",
                "--use",
                "--assume-yes",
                "--post-install-file",
                match.string,
            ]);
        });

        test("should attempt to install toolchain with progress callback on macOS", async () => {
            mockedPlatform.setValue("darwin");
            const progressCallback = () => {};

            mockUtilities.execFile.withArgs("mkfifo").resolves({ stdout: "", stderr: "" });
            mockUtilities.execFile.withArgs("swiftly", match.array).resolves({
                stdout: "",
                stderr: "",
            });
            os.tmpdir();
            mockFS({});

            // This test verifies the method starts the installation process
            // The actual file stream handling is complex to mock properly
            try {
                await Swiftly.installToolchain("6.0.0", progressCallback);
            } catch (error) {
                // Expected due to mock-fs limitations with named pipes
                expect((error as Error).message).to.include("ENOENT");
            }

            expect(mockUtilities.execFile).to.have.been.calledWith("mkfifo", match.array);
        });

        test("should handle installation error properly", async () => {
            mockedPlatform.setValue("darwin");
            const installError = new Error("Installation failed");
            mockUtilities.execFile.withArgs("swiftly").rejects(installError);

            const tmpDir = os.tmpdir();
            mockFS({
                [tmpDir]: {},
            });

            await expect(
                Swiftly.installToolchain("6.0.0", undefined)
            ).to.eventually.be.rejectedWith("Installation failed");
        });
    });

    suite("listAvailable", () => {
        test("should return empty array on unsupported platform", async () => {
            mockedPlatform.setValue("win32");

            const result = await Swiftly.listAvailable();

            expect(result).to.deep.equal([]);
        });

        test("should return empty array when Swiftly is not installed", async () => {
            mockedPlatform.setValue("darwin");
            mockUtilities.execFile
                .withArgs("swiftly", ["--version"])
                .rejects(new Error("Command not found"));

            const result = await Swiftly.listAvailable();

            expect(result).to.deep.equal([]);
        });

        test("should return empty array when Swiftly version doesn't support JSON output", async () => {
            mockedPlatform.setValue("darwin");
            mockUtilities.execFile.withArgs("swiftly", ["--version"]).resolves({
                stdout: "1.0.0\n",
                stderr: "",
            });

            const result = await Swiftly.listAvailable();

            expect(result).to.deep.equal([]);
        });

        test("should return available toolchains with installation status", async () => {
            mockedPlatform.setValue("darwin");

            mockUtilities.execFile.withArgs("swiftly", ["--version"]).resolves({
                stdout: "1.1.0\n",
                stderr: "",
            });

            const availableResponse = {
                toolchains: [
                    {
                        version: {
                            type: "stable",
                            major: 6,
                            minor: 0,
                            patch: 0,
                            name: "6.0.0",
                        },
                    },
                    {
                        version: {
                            type: "snapshot",
                            major: 6,
                            minor: 1,
                            branch: "main",
                            date: "2025-01-15",
                            name: "main-snapshot-2025-01-15",
                        },
                    },
                ],
            };

            mockUtilities.execFile
                .withArgs("swiftly", ["list-available", "--format=json"])
                .resolves({
                    stdout: JSON.stringify(availableResponse),
                    stderr: "",
                });

            const installedResponse = {
                toolchains: [
                    {
                        inUse: true,
                        isDefault: true,
                        version: {
                            type: "stable",
                            major: 6,
                            minor: 0,
                            patch: 0,
                            name: "6.0.0",
                        },
                    },
                ],
            };

            mockUtilities.execFile.withArgs("swiftly", ["list", "--format=json"]).resolves({
                stdout: JSON.stringify(installedResponse),
                stderr: "",
            });

            const result = await Swiftly.listAvailable();
            expect(result).to.deep.equal([
                {
                    name: "6.0.0",
                    type: "stable",
                    version: "6.0.0",
                    isInstalled: true,
                },
                {
                    name: "main-snapshot-2025-01-15",
                    type: "snapshot",
                    version: "main-snapshot-2025-01-15",
                    isInstalled: false,
                },
            ]);
        });

        test("should handle errors when fetching available toolchains", async () => {
            mockedPlatform.setValue("darwin");
            mockUtilities.execFile.withArgs("swiftly", ["--version"]).resolves({
                stdout: "1.1.0\n",
                stderr: "",
            });
            mockUtilities.execFile
                .withArgs("swiftly", ["list-available", "--format=json"])
                .rejects(new Error("Network error"));
            const result = await Swiftly.listAvailable();
            expect(result).to.deep.equal([]);
        });
    });
});
