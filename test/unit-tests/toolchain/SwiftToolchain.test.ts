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
import * as path from "path";

import { Environment } from "@src/services/Environment";
import { SwiftToolchain } from "@src/toolchain/SwiftToolchain";
import * as utilities from "@src/utilities/utilities";
import { Version } from "@src/utilities/version";

import {
    MockedFunction,
    MockedObject,
    instance,
    mockFn,
    mockObject,
    setupSandboxForTests,
} from "../../MockUtils";

suite("SwiftToolchain Unit Test Suite", () => {
    const sandbox = setupSandboxForTests();
    let mockedExecFile: MockedFunction<typeof utilities.execFile>;
    let mockedEnv: MockedObject<Environment>;

    setup(() => {
        mockFS({});
        mockedExecFile = sandbox.stub(utilities, "execFile");
        mockedExecFile.withArgs("swiftly", ["--version"]).resolves({
            stdout: "1.0.0\n",
            stderr: "",
        });
        mockedEnv = mockObject<Environment>({
            platform: "darwin",
            env: mockFn(s => s.returns({})),
        });
    });

    teardown(() => {
        mockFS.restore();
    });

    suite("getLLDBDebugAdapter()", () => {
        function createSwiftToolchain(options: {
            swiftFolderPath: string;
            toolchainPath: string;
        }): SwiftToolchain {
            return new SwiftToolchain(
                instance(mockedEnv),
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
                mockedEnv.platform = "darwin";
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
                    swiftFolderPath:
                        "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin",
                    toolchainPath: "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equal(
                    path.normalize(
                        "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin/lldb-dap"
                    )
                );
            });

            test("throws an error if lldb-dap does not exist within a public toolchain", async () => {
                mockFS({
                    "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin": {},
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath:
                        "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin",
                    toolchainPath: "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.be.rejectedWith(
                    "Failed to find lldb-dap within Swift toolchain '/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain'"
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
                mockedExecFile.resolves({
                    stdout: "/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap",
                    stderr: "",
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath:
                        "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin",
                    toolchainPath:
                        "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equal(
                    "/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap"
                );
            });

            test("throws an error if xcrun fails when trying to find lldb-dap within an Xcode toolchain", async () => {
                mockFS({
                    "/Applications/Xcode.app/Contents/Developer": {
                        Toolchains: {
                            "XcodeDefault.xctoolchain": {},
                        },
                        usr: {
                            bin: {},
                        },
                    },
                });
                mockedExecFile.rejects(new Error("Uh oh!"));
                const sut = createSwiftToolchain({
                    swiftFolderPath:
                        "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin",
                    toolchainPath:
                        "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.be.rejectedWith(
                    "Failed to find lldb-dap within Xcode Swift toolchain '/Applications/Xcode.app'"
                );
            });
        });

        suite("Linux", () => {
            setup(() => {
                mockedEnv.platform = "linux";
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
                    toolchainPath: "/toolchains/swift-6.0.0",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equal(
                    path.normalize("/toolchains/swift-6.0.0/usr/bin/lldb-dap")
                );
            });

            test("throws an error if lldb dap doesn't exist within the toolchain", async () => {
                mockFS({
                    "/toolchains/swift-6.0.0/usr/bin": {},
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath: "/toolchains/swift-6.0.0/usr/bin",
                    toolchainPath: "/toolchains/swift-6.0.0",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.be.rejectedWith(
                    "Failed to find lldb-dap within Swift toolchain '/toolchains/swift-6.0.0'"
                );
            });
        });

        suite("Windows", () => {
            setup(() => {
                mockedEnv.platform = "win32";
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
                    toolchainPath: "/toolchains/swift-6.0.0",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equal(
                    path.normalize("/toolchains/swift-6.0.0/usr/bin/lldb-dap.exe")
                );
            });

            test("throws an error if lldb-dap.exe doesn't exist within the toolchain", async () => {
                mockFS({
                    "/toolchains/swift-6.0.0/usr/bin": {},
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath: "/toolchains/swift-6.0.0/usr/bin",
                    toolchainPath: "/toolchains/swift-6.0.0",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.be.rejectedWith(
                    "Failed to find lldb-dap.exe within Swift toolchain '/toolchains/swift-6.0.0'"
                );
            });
        });
    });
});
