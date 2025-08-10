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
import { Swiftly } from "../../../src/toolchain/swiftly";
import * as utilities from "../../../src/utilities/utilities";
import * as shell from "../../../src/utilities/shell";
import { mockGlobalModule, mockGlobalValue } from "../../MockUtils";

suite("Swiftly Unit Tests", () => {
    const mockUtilities = mockGlobalModule(utilities);
    const mockShell = mockGlobalModule(shell);
    const mockedPlatform = mockGlobalValue(process, "platform");

    setup(() => {
        mockedPlatform.setValue("darwin");
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

    suite("isInstalled", () => {
        test("should return true when swiftly is found", async () => {
            mockShell.findBinaryPath.withArgs("swiftly").resolves("/usr/local/bin/swiftly");

            const result = await Swiftly.isInstalled();

            expect(result).to.be.true;
            expect(mockShell.findBinaryPath).to.have.been.calledWith("swiftly");
        });

        test("should return false when swiftly is not found", async () => {
            mockShell.findBinaryPath.withArgs("swiftly").rejects(new Error("not found"));

            const result = await Swiftly.isInstalled();

            expect(result).to.be.false;
            expect(mockShell.findBinaryPath).to.have.been.calledWith("swiftly");
        });

        test("should return false when platform is not supported", async () => {
            mockedPlatform.setValue("win32");

            const result = await Swiftly.isInstalled();

            expect(result).to.be.false;
            expect(mockShell.findBinaryPath).not.to.have.been.called;
        });
    });
});
