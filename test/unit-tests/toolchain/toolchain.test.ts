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
import * as mockFS from "mock-fs";

import { SwiftToolchain } from "@src/toolchain/toolchain";
import * as utilities from "@src/utilities/utilities";
import { Version } from "@src/utilities/version";

import { mockGlobalModule, mockGlobalValue } from "../../MockUtils";

suite("SwiftToolchain Unit Test Suite", () => {
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

    suite("getLLDBDebugAdapter()", () => {
        function createSwiftToolchain(options: {
            manager?: "xcrun" | "swiftly" | "swiftenv" | "unknown";
            swiftFolderPath: string;
            toolchainPath: string;
        }): SwiftToolchain {
            return new SwiftToolchain(
                options.manager ?? "unknown",
                options.swiftFolderPath,
                options.toolchainPath,
                /* targetInfo */ {
                    compilerVersion: "6.0.0",
                    paths: {
                        runtimeLibraryPaths: [],
                    },
                },
                /* swiftVersion */ new Version(6, 0, 0),
                /* runtimePath */ undefined,
                /* defaultSDK */ undefined,
                /* customSDK */ undefined,
                /* xcTestPath */ undefined,
                /* swiftTestingPath */ undefined,
                /* swiftPMTestingHelperPath */ undefined
            );
        }

        suite("macOS", () => {
            setup(() => {
                mockedPlatform.setValue("darwin");
            });

            test("returns the path to lldb-dap if it exists within a public toolchain", async () => {
                mockFS({
                    "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin/lldb-dap":
                        mockFS.file({
                            content: "",
                            mode: 0o770,
                        }),
                });
                const sut = createSwiftToolchain({
                    manager: "unknown",
                    swiftFolderPath:
                        "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin/swift",
                    toolchainPath:
                        "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equalPath(
                    "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin/lldb-dap"
                );
            });

            test("throws an error if lldb-dap does not exist within a public toolchain", async () => {
                mockFS({
                    "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin": {},
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath:
                        "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin",
                    toolchainPath:
                        "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.be.rejectedWith(
                    "Failed to find lldb-dap within Swift toolchain"
                );
            });

            test("returns the path to lldb-dap if it exists within an Xcode toolchain", async () => {
                mockFS({
                    "/Applications/Xcode.app/Contents/Developer": {
                        Toolchains: {
                            "XcodeDefault.xctoolchain": {},
                        },
                        usr: {
                            bin: {
                                "lldb-dap": mockFS.file({
                                    content: "",
                                    mode: 0o770,
                                }),
                            },
                        },
                    },
                });
                mockedUtilities.execFile.withArgs("xcrun", ["--find", "lldb-dap"]).resolves({
                    stdout: "/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap",
                    stderr: "",
                });
                const sut = createSwiftToolchain({
                    manager: "xcrun",
                    swiftFolderPath: "/usr/bin/swift",
                    toolchainPath:
                        "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equalPath(
                    "/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap"
                );
            });

            test("returns the path to lldb-dap if it exists within a CommandLineTools toolchain", async () => {
                mockFS({
                    "/usr/bin/swift": mockFS.file({ content: "", mode: 0o770 }),
                    "/Library/Developer/CommandLineTools/usr/bin": {
                        swift: mockFS.file({ content: "", mode: 0o770 }),
                        "lldb-dap": mockFS.file({ content: "", mode: 0o770 }),
                    },
                });
                const sut = createSwiftToolchain({
                    manager: "xcrun",
                    swiftFolderPath: "/usr/bin/swift",
                    toolchainPath: "/Library/Developer/CommandLineTools/usr",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equalPath(
                    "/Library/Developer/CommandLineTools/usr/bin/lldb-dap"
                );
            });

            test("returns the path to lldb-dap if it exists within an Xcode toolchain selected using swift.path", async () => {
                mockFS({
                    "/Applications/Xcode.app/Contents/Developer": {
                        Toolchains: {
                            "XcodeDefault.xctoolchain": {},
                        },
                        usr: {
                            bin: {
                                "lldb-dap": mockFS.file({
                                    content: "",
                                    mode: 0o770,
                                }),
                            },
                        },
                    },
                });
                mockedUtilities.execFile.withArgs("xcrun", ["--find", "lldb-dap"]).resolves({
                    stdout: "/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap",
                    stderr: "",
                });
                const sut = createSwiftToolchain({
                    manager: "unknown",
                    swiftFolderPath:
                        "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr",
                    toolchainPath:
                        "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equalPath(
                    "/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap"
                );
            });
        });

        suite("Linux", () => {
            setup(() => {
                mockedPlatform.setValue("linux");
            });

            test("returns the path to lldb-dap if it exists within the toolchain", async () => {
                mockFS({
                    "/toolchains/swift-6.0.0/usr/bin": {
                        "lldb-dap": mockFS.file({
                            content: "",
                            mode: 0o770,
                        }),
                    },
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath: "/toolchains/swift-6.0.0/usr/bin",
                    toolchainPath: "/toolchains/swift-6.0.0/usr",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equalPath(
                    "/toolchains/swift-6.0.0/usr/bin/lldb-dap"
                );
            });

            test("throws an error if lldb dap doesn't exist within the toolchain", async () => {
                mockFS({
                    "/toolchains/swift-6.0.0/usr/bin": {},
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath: "/toolchains/swift-6.0.0/usr/bin",
                    toolchainPath: "/toolchains/swift-6.0.0/usr",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.be.rejectedWith(
                    "Failed to find lldb-dap within Swift toolchain"
                );
            });
        });

        suite("Windows", () => {
            setup(() => {
                mockedPlatform.setValue("win32");
            });

            test("returns the path to lldb-dap.exe if it exists within the toolchain", async () => {
                mockFS({
                    "/toolchains/swift-6.0.0/usr/bin": {
                        "lldb-dap.exe": mockFS.file({
                            content: "",
                            mode: 0o770,
                        }),
                    },
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath: "/toolchains/swift-6.0.0/usr/bin",
                    toolchainPath: "/toolchains/swift-6.0.0/usr",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equalPath(
                    "/toolchains/swift-6.0.0/usr/bin/lldb-dap.exe"
                );
            });

            test("throws an error if lldb-dap.exe doesn't exist within the toolchain", async () => {
                mockFS({
                    "/toolchains/swift-6.0.0/usr/bin": {},
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath: "/toolchains/swift-6.0.0/usr/bin",
                    toolchainPath: "/toolchains/swift-6.0.0/usr",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.be.rejectedWith(
                    "Failed to find lldb-dap.exe within Swift toolchain"
                );
            });
        });
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
            expect(inv.command).to.equal("/toolchains/swift-6.0.0/usr/bin/swift");
            expect(inv.args).to.deep.equal(["build", "--configuration", "debug"]);
        });

        test("xcrun toolchain returns direct binary path with caller args", () => {
            mockedPlatform.setValue("darwin");
            const tc = createToolchain(
                "xcrun",
                "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr"
            );
            const inv = tc.getToolchainInvocation("swift", ["package", "describe"]);
            expect(inv.command).to.equal(
                "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift"
            );
            expect(inv.args).to.deep.equal(["package", "describe"]);
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

        test("swiftly toolchain wraps lldb-dap correctly with no extra args", () => {
            mockedPlatform.setValue("linux");
            const tc = createToolchain("swiftly", "/home/user/.swiftly/toolchains/6.0.0/usr");
            const inv = tc.getToolchainInvocation("lldb-dap", []);
            expect(inv.command).to.equal("swiftly");
            expect(inv.args).to.deep.equal(["run", "lldb-dap"]);
        });

        test("getToolchainExecutablePath always returns raw path regardless of manager", () => {
            mockedPlatform.setValue("linux");
            const swiftly = createToolchain("swiftly", "/home/user/.swiftly/toolchains/6.0.0/usr");
            const unknown = createToolchain("unknown", "/toolchains/swift-6.0.0/usr");
            expect(swiftly.getToolchainExecutablePath("swift")).to.equal(
                "/home/user/.swiftly/toolchains/6.0.0/usr/bin/swift"
            );
            expect(unknown.getToolchainExecutablePath("sourcekit-lsp")).to.equal(
                "/toolchains/swift-6.0.0/usr/bin/sourcekit-lsp"
            );
        });

        test("Windows appends .exe to raw path but not to swiftly invocation", () => {
            mockedPlatform.setValue("win32");
            const swiftly = createToolchain("swiftly", "C:/toolchains/swift-6.0.0/usr");
            const unknown = createToolchain("unknown", "C:/toolchains/swift-6.0.0/usr");
            expect(swiftly.getToolchainInvocation("swift", []).command).to.equal("swiftly");
            expect(unknown.getToolchainInvocation("swift", []).command).to.equal(
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
