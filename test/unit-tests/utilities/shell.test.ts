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

import { findBinaryInPath } from "@src/utilities/shell";
import * as utilities from "@src/utilities/utilities";

import { mockGlobalModule, mockGlobalValue } from "../../MockUtils";

suite("Shell Unit Test Suite", () => {
    const mockedUtilities = mockGlobalModule(utilities);
    const mockedPlatform = mockGlobalValue(process, "platform");

    setup(() => {
        mockedUtilities.execFile.rejects(
            Error("execFile() was not properly mocked for this test.")
        );
    });

    suite("findBinaryInPath()", () => {
        suite("macOS", () => {
            setup(() => {
                mockedPlatform.setValue("darwin");
            });

            test("returns the path to a binary in the PATH", async () => {
                mockedUtilities.execFile.withArgs("which", ["node"]).resolves({
                    stdout: "/usr/local/bin/node\n",
                    stderr: "",
                });

                await expect(findBinaryInPath("node")).to.eventually.equalPath(
                    "/usr/local/bin/node"
                );
            });

            test("throws for a non-existent binary", async () => {
                mockedUtilities.execFile
                    .withArgs("which", ["nonexistentbinary"])
                    .rejects(Error("process exited with code 1"));

                await expect(findBinaryInPath("nonexistentbinary")).to.eventually.be.rejected;
            });
        });

        suite("Linux", () => {
            setup(() => {
                mockedPlatform.setValue("linux");
            });

            test("returns the path to a binary in the PATH", async () => {
                mockedUtilities.execFile
                    .withArgs("/bin/sh", ["-c", "LC_MESSAGES=C type node"])
                    .resolves({
                        stdout: "node is /usr/local/bin/node\n",
                        stderr: "",
                    });

                await expect(findBinaryInPath("node")).to.eventually.equalPath(
                    "/usr/local/bin/node"
                );
            });

            test("throws for a non-existent binary", async () => {
                mockedUtilities.execFile
                    .withArgs("/bin/sh", ["-c", "LC_MESSAGES=C type nonexistentbinary"])
                    .rejects(Error("process exited with code 1"));

                await expect(findBinaryInPath("nonexistentbinary")).to.eventually.be.rejected;
            });
        });

        suite("Windows", () => {
            setup(() => {
                mockedPlatform.setValue("win32");
            });

            test("returns the path to a binary in the PATH", async () => {
                mockedUtilities.execFile.withArgs("where.exe", ["node"]).resolves({
                    stdout: "/usr/local/bin/node\r\n/usr/local/other/bin/node\r\n",
                    stderr: "",
                });

                await expect(findBinaryInPath("node")).to.eventually.equalPath(
                    "/usr/local/bin/node"
                );
            });

            test("throws for a non-existent binary", async () => {
                mockedUtilities.execFile
                    .withArgs("where.exe", ["nonexistentbinary"])
                    .rejects(Error("process exited with code 1"));

                await expect(findBinaryInPath("nonexistentbinary")).to.eventually.be.rejected;
            });
        });
    });
});
