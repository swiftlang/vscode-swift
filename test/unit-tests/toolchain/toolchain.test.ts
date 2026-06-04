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

import { Swiftly } from "@src/toolchain/swiftly";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import * as utilities from "@src/utilities/utilities";
import { Version } from "@src/utilities/version";

import { mockGlobalModule, mockGlobalValue } from "../../MockUtils";

import mockFS = require("mock-fs");

suite("SwiftToolchain Unit Test Suite", () => {
    const mockedSwiftly = mockGlobalModule(Swiftly);
    const mockedUtilities = mockGlobalModule(utilities);
    const mockedPlatform = mockGlobalValue(process, "platform");

    setup(() => {
        mockFS({});
        mockedUtilities.execFile.rejects(
            Error("execFile() was not properly mocked for this test.")
        );
    });

    teardown(() => {
        mockFS.restore();
    });

    suite("getToolchainInvocation()", () => {
        function createToolchain(
            manager: "xcrun" | "swiftly" | "swiftenv" | "unknown",
            toolchainPath: string
        ): SwiftToolchain {
            return new SwiftToolchain(
                manager,
                `${toolchainPath}/bin`,
                toolchainPath,
                { compilerVersion: "6.0.0", paths: { runtimeLibraryPaths: [] } },
                new Version(6, 0, 0)
            );
        }

        test("normal toolchain returns direct binary path with caller args", () => {
            mockedPlatform.setValue("linux");
            const tc = createToolchain("unknown", "/toolchains/swift-6.0.0/usr");
            const inv = tc.getToolchainInvocation("swift", ["build", "--configuration", "debug"]);
            expect(inv.command).to.equalPath("/toolchains/swift-6.0.0/usr/bin/swift");
            expect(inv.args).to.deep.equal(["build", "--configuration", "debug"]);
        });

        test("xcrun toolchain wraps as xcrun <tool>", () => {
            mockedPlatform.setValue("darwin");
            const tc = createToolchain(
                "xcrun",
                "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr"
            );
            const inv = tc.getToolchainInvocation("swift", ["package", "describe"]);
            expect(inv.command).to.equalPath("xcrun");
            expect(inv.args).to.deep.equal(["swift", "package", "describe"]);
        });

        test("swiftly toolchain wraps as swiftly run <tool>", () => {
            mockedPlatform.setValue("linux");
            const tc = createToolchain("swiftly", "/home/user/.swiftly/toolchains/6.0.0/usr");
            const inv = tc.getToolchainInvocation("swift", ["build"]);
            expect(inv.command).to.equal("swiftly");
            expect(inv.args).to.deep.equal(["run", "swift", "build"]);
        });

        test("swiftly toolchain wraps sourcekit-lsp correctly", () => {
            mockedPlatform.setValue("linux");
            const tc = createToolchain("swiftly", "/home/user/.swiftly/toolchains/6.0.0/usr");
            const inv = tc.getToolchainInvocation("sourcekit-lsp", []);
            expect(inv.command).to.equal("swiftly");
            expect(inv.args).to.deep.equal(["run", "sourcekit-lsp"]);
        });

        test("swiftly toolchain wraps lldb-dap correctly", async () => {
            mockedPlatform.setValue("linux");
            mockedSwiftly.inUseVersion.resolves("6.2.0");
            const tc = createToolchain("swiftly", "/home/user/.swiftly/toolchains/6.0.0/usr");
            const inv = await tc.getDebuggerToolchainInvocation("lldb-dap", []);
            expect(inv.command).to.equal("swiftly");
            expect(inv.args).to.deep.equal(["run", "lldb-dap"]);
        });

        test("swiftly toolchain uses xcrun to launch lldb-dap if toolchain is xcode", async () => {
            mockedPlatform.setValue("linux");
            mockedSwiftly.inUseVersion.resolves("xcode");
            const tc = createToolchain("swiftly", "/home/user/.swiftly/toolchains/6.0.0/usr");
            const inv = await tc.getDebuggerToolchainInvocation("lldb-dap", []);
            expect(inv.command).to.equal("xcrun");
            expect(inv.args).to.deep.equal(["lldb-dap"]);
        });

        test("getToolchainExecutablePath always returns raw path regardless of manager", () => {
            mockedPlatform.setValue("linux");
            const swiftly = createToolchain("swiftly", "/home/user/.swiftly/toolchains/6.0.0/usr");
            const unknown = createToolchain("unknown", "/toolchains/swift-6.0.0/usr");
            expect(swiftly.getToolchainExecutablePath("swift")).to.equalPath(
                "/home/user/.swiftly/toolchains/6.0.0/usr/bin/swift"
            );
            expect(unknown.getToolchainExecutablePath("sourcekit-lsp")).to.equalPath(
                "/toolchains/swift-6.0.0/usr/bin/sourcekit-lsp"
            );
        });

        test("Windows appends .exe to raw path but not to swiftly invocation", () => {
            mockedPlatform.setValue("win32");
            const swiftly = createToolchain("swiftly", "C:/toolchains/swift-6.0.0/usr");
            const unknown = createToolchain("unknown", "C:/toolchains/swift-6.0.0/usr");
            expect(swiftly.getToolchainInvocation("swift", []).command).to.equal("swiftly");
            expect(unknown.getToolchainInvocation("swift", []).command).to.equalPath(
                "C:/toolchains/swift-6.0.0/usr/bin/swift.exe"
            );
        });
    });

    suite("findXcodeInstalls()", () => {
        test("returns the list of Xcode installations found in the Spotlight index on macOS", async () => {
            mockedPlatform.setValue("darwin");
            mockedUtilities.execFile.withArgs("mdfind").resolves({
                stdout: "/Applications/Xcode.app\n/Applications/Xcode-beta.app\n",
                stderr: "",
            });
            mockedUtilities.execFile
                .withArgs("xcode-select", ["-p"])
                .resolves({ stdout: "", stderr: "" });

            const sortedXcodeInstalls = (await SwiftToolchain.findXcodeInstalls()).sort((a, b) =>
                a.localeCompare(b)
            );
            expect(sortedXcodeInstalls).to.deep.equal([
                "/Applications/Xcode-beta.app",
                "/Applications/Xcode.app",
            ]);
        });

        test("includes the currently selected Xcode installation on macOS", async () => {
            mockedPlatform.setValue("darwin");
            mockedUtilities.execFile.withArgs("mdfind").resolves({
                stdout: "/Applications/Xcode-beta.app\n",
                stderr: "",
            });
            mockedUtilities.execFile
                .withArgs("xcode-select", ["-p"])
                .resolves({ stdout: "/Applications/Xcode.app\n", stderr: "" });

            const sortedXcodeInstalls = (await SwiftToolchain.findXcodeInstalls()).sort((a, b) =>
                a.localeCompare(b)
            );
            expect(sortedXcodeInstalls).to.deep.equal([
                "/Applications/Xcode-beta.app",
                "/Applications/Xcode.app",
            ]);
        });

        test("does not duplicate the currently selected Xcode installation on macOS", async () => {
            mockedPlatform.setValue("darwin");
            mockedUtilities.execFile.withArgs("mdfind").resolves({
                stdout: "/Applications/Xcode.app\n/Applications/Xcode-beta.app\n",
                stderr: "",
            });
            mockedUtilities.execFile
                .withArgs("xcode-select", ["-p"])
                .resolves({ stdout: "/Applications/Xcode.app\n", stderr: "" });

            const sortedXcodeInstalls = (await SwiftToolchain.findXcodeInstalls()).sort((a, b) =>
                a.localeCompare(b)
            );
            expect(sortedXcodeInstalls).to.deep.equal([
                "/Applications/Xcode-beta.app",
                "/Applications/Xcode.app",
            ]);
        });

        test("returns an empty array on non-macOS platforms", async () => {
            mockedPlatform.setValue("linux");
            await expect(SwiftToolchain.findXcodeInstalls()).to.eventually.be.empty;

            mockedPlatform.setValue("win32");
            await expect(SwiftToolchain.findXcodeInstalls()).to.eventually.be.empty;
        });
    });
});
