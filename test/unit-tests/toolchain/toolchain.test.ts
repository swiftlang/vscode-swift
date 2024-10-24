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
import * as os from "os";
import * as utilities from "../../../src/utilities/utilities";
import { SwiftProjectTemplate, SwiftToolchain } from "../../../src/toolchain/toolchain";
import { Version } from "../../../src/utilities/version";
import { mockFileSystem, mockGlobalModule } from "../../MockUtils";

suite("SwiftToolchain Unit Test Suite", () => {
    const mockedUtilities = mockGlobalModule(utilities);
    const mockedProcess = mockGlobalModule(process, {
        platform: process.platform,
        env: process.env,
    });
    const mockedOS = mockGlobalModule(os, { homedir: () => "" });
    const mockFS = mockFileSystem();

    setup(() => {
        mockedUtilities.execFile.rejects(
            new Error("execFile was not properly mocked for the test")
        );
    });

    suite("getXcodeDeveloperDir()", () => {
        test("returns the path to the Xcode developer directory using xcrun", async () => {
            mockedUtilities.execFile.resolves({
                stderr: "",
                stdout: "/path/to/Xcode/developer/dir\r\n\r\n",
            });
            await expect(SwiftToolchain.getXcodeDeveloperDir()).to.eventually.equal(
                "/path/to/Xcode/developer/dir"
            );
        });
    });

    suite("getSDKPath()", () => {
        test("returns the path to the given SDK using xcrun", async () => {
            mockedUtilities.execFile.resolves({
                stderr: "",
                stdout: "/path/to/macOS/sdk/\r\n\r\n",
            });
            await expect(SwiftToolchain.getSDKPath("macOS")).to.eventually.equal(
                "/path/to/macOS/sdk/"
            );
        });
    });

    suite("getXcodeInstalls()", () => {
        test("returns an array of available Xcode installations on macOS", async () => {
            mockedProcess.platform = "darwin";
            mockedUtilities.execFile.resolves({
                stderr: "",
                stdout: "/Applications/Xcode1.app\n/Applications/Xcode2.app\n/Applications/Xcode3.app\n\n\n\n\n",
            });
            await expect(SwiftToolchain.getXcodeInstalls()).to.eventually.deep.equal([
                "/Applications/Xcode1.app",
                "/Applications/Xcode2.app",
                "/Applications/Xcode3.app",
            ]);
        });

        test("does nothing on Linux", async () => {
            mockedProcess.platform = "linux";
            await expect(SwiftToolchain.getXcodeInstalls()).to.eventually.be.empty;
            expect(mockedUtilities.execFile).to.not.have.been.called;
        });

        test("does nothing on Windows", async () => {
            mockedProcess.platform = "win32";
            await expect(SwiftToolchain.getXcodeInstalls()).to.eventually.be.empty;
            expect(mockedUtilities.execFile).to.not.have.been.called;
        });
    });

    suite("getSwiftlyToolchainInstalls()", () => {
        test("returns an array of available Swiftly toolchains on Linux if Swiftly is installed", async () => {
            mockedProcess.platform = "linux";
            mockedProcess.env = {
                SWIFTLY_HOME_DIR: "/path/to/swiftly/home",
            };
            mockFS({
                "/path/to/swiftly/home/config.json": JSON.stringify({
                    installedToolchains: ["swift-DEVELOPMENT-6.0.0", "swift-6.0.0", "swift-5.10.1"],
                }),
            });
            await expect(SwiftToolchain.getSwiftlyToolchainInstalls()).to.eventually.deep.equal([
                "/path/to/swiftly/home/toolchains/swift-DEVELOPMENT-6.0.0",
                "/path/to/swiftly/home/toolchains/swift-6.0.0",
                "/path/to/swiftly/home/toolchains/swift-5.10.1",
            ]);
        });

        test("does nothing if Swiftly in not installed", async () => {
            mockedProcess.platform = "linux";
            mockedProcess.env = {};
            mockFS({});
            await expect(SwiftToolchain.getSwiftlyToolchainInstalls()).to.eventually.be.empty;
        });

        test("returns an empty array if no Swiftly configuration is present", async () => {
            mockedProcess.platform = "linux";
            mockedProcess.env = {
                SWIFTLY_HOME_DIR: "/path/to/swiftly/home",
            };
            mockFS({});
            await expect(SwiftToolchain.getSwiftlyToolchainInstalls()).to.eventually.be.empty;
        });

        test("returns an empty array if Swiftly configuration is in an unexpected format (installedToolchains is not an array)", async () => {
            mockedProcess.platform = "linux";
            mockedProcess.env = {
                SWIFTLY_HOME_DIR: "/path/to/swiftly/home",
            };
            mockFS({
                "/path/to/swiftly/home/config.json": JSON.stringify({
                    installedToolchains: {
                        "swift-DEVELOPMENT-6.0.0": "toolchains/swift-DEVELOPMENT-6.0.0",
                        "swift-6.0.0": "toolchains/swift-6.0.0",
                        "swift-5.10.1": "toolchains/swift-5.10.1",
                    },
                }),
            });
            await expect(SwiftToolchain.getSwiftlyToolchainInstalls()).to.eventually.be.empty;
        });

        test("returns an empty array if Swiftly configuration is in an unexpected format (elements of installedToolchains are not strings)", async () => {
            mockedProcess.platform = "linux";
            mockedProcess.env = {
                SWIFTLY_HOME_DIR: "/path/to/swiftly/home",
            };
            mockFS({
                "/path/to/swiftly/home/config.json": JSON.stringify({
                    installedToolchains: [
                        { "swift-DEVELOPMENT-6.0.0": "toolchains/swift-DEVELOPMENT-6.0.0" },
                        { "swift-6.0.0": "toolchains/swift-6.0.0" },
                        { "swift-5.10.1": "toolchains/swift-5.10.1" },
                    ],
                }),
            });
            await expect(SwiftToolchain.getSwiftlyToolchainInstalls()).to.eventually.be.empty;
        });

        test("returns an empty array if Swiftly configuration is in an unexpected format (installedToolchains does not exist)", async () => {
            mockedProcess.platform = "linux";
            mockedProcess.env = {
                SWIFTLY_HOME_DIR: "/path/to/swiftly/home",
            };
            mockFS({
                "/path/to/swiftly/home/config.json": JSON.stringify({
                    toolchains: ["swift-DEVELOPMENT-6.0.0", "swift-6.0.0", "swift-5.10.1"],
                }),
            });
            await expect(SwiftToolchain.getSwiftlyToolchainInstalls()).to.eventually.be.empty;
        });

        test("returns an empty array if Swiftly configuration is corrupt", async () => {
            mockedProcess.platform = "linux";
            mockedProcess.env = {
                SWIFTLY_HOME_DIR: "/path/to/swiftly/home",
            };
            mockFS({
                "/path/to/swiftly/home/config.json": "{",
            });
            await expect(SwiftToolchain.getSwiftlyToolchainInstalls()).to.eventually.be.empty;
        });

        test("does nothing on macOS", async () => {
            mockedProcess.platform = "darwin";
            mockedProcess.env = {
                SWIFTLY_HOME_DIR: "/path/to/swiftly/home",
            };
            mockFS({});
            await expect(SwiftToolchain.getSwiftlyToolchainInstalls()).to.eventually.be.empty;
        });

        test("does nothing on Windows", async () => {
            mockedProcess.platform = "win32";
            mockedProcess.env = {
                SWIFTLY_HOME_DIR: "/path/to/swiftly/home",
            };
            mockFS({});
            await expect(SwiftToolchain.getSwiftlyToolchainInstalls()).to.eventually.be.empty;
        });
    });

    suite("getToolchainInstalls()", () => {
        test("returns an array of available toolchains on macOS", async () => {
            mockedProcess.platform = "darwin";
            mockedOS.homedir.returns("/Users/test/");
            mockFS({
                "/Library/Developer/Toolchains": {
                    "swift-latest": mockFS.symlink({ path: "swift-6.0.0" }),
                    "swift-6.0.0": {
                        usr: { bin: { swift: "" } },
                    },
                    "swift-5.10.1": {
                        usr: { bin: { swift: "" } },
                    },
                    "swift-no-toolchain": {},
                    "swift-file": "",
                },
                "/Users/test/Library/Developer/Toolchains": {
                    "swift-latest": mockFS.symlink({ path: "swift-6.0.0" }),
                    "swift-6.0.0": {
                        usr: { bin: { swift: "" } },
                    },
                    "swift-5.10.1": {
                        usr: { bin: { swift: "" } },
                    },
                    "swift-no-toolchain": {},
                    "swift-file": "",
                },
            });
            const actualValue = (await SwiftToolchain.getToolchainInstalls()).sort();
            const expectedValue = [
                "/Library/Developer/Toolchains/swift-latest",
                "/Library/Developer/Toolchains/swift-6.0.0",
                "/Library/Developer/Toolchains/swift-5.10.1",
                "/Users/test/Library/Developer/Toolchains/swift-latest",
                "/Users/test/Library/Developer/Toolchains/swift-6.0.0",
                "/Users/test/Library/Developer/Toolchains/swift-5.10.1",
            ].sort();
            expect(actualValue).to.deep.equal(expectedValue);
        });

        test("returns an empty array if no toolchains are present", async () => {
            mockedProcess.platform = "darwin";
            mockedOS.homedir.returns("/Users/test/");
            mockFS({});
            await expect(SwiftToolchain.getToolchainInstalls()).to.eventually.be.empty;
        });

        test("does nothing on Linux", async () => {
            mockedProcess.platform = "linux";
            mockedOS.homedir.returns("/Users/test/");
            mockFS({});
            await expect(SwiftToolchain.getToolchainInstalls()).to.eventually.be.empty;
        });

        test("does nothing on Windows", async () => {
            mockedProcess.platform = "win32";
            mockedOS.homedir.returns("/Users/test/");
            mockFS({});
            await expect(SwiftToolchain.getToolchainInstalls()).to.eventually.be.empty;
        });
    });

    suite("getLLDBDebugAdapter()", () => {
        function createSwiftToolchain(options: {
            swiftFolderPath: string;
            toolchainPath: string;
        }): SwiftToolchain {
            return new SwiftToolchain(
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
                mockedProcess.platform = "darwin";
            });

            test("returns the path to lldb-dap if it exists within a public toolchain", async () => {
                mockFS({
                    "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin/lldb-dap":
                        mockFS.file({ mode: 0o770 }),
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath:
                        "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain/usr/bin",
                    toolchainPath: "/Library/Developer/Toolchains/swift-6.0.1-RELEASE.xctoolchain",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equal(
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
                                "lldb-dap": mockFS.file({ mode: 0o770 }),
                            },
                        },
                    },
                });
                mockedUtilities.execFile.resolves({
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
                mockedUtilities.execFile.rejects(new Error("Uh oh!"));
                const sut = createSwiftToolchain({
                    swiftFolderPath:
                        "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin",
                    toolchainPath:
                        "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.be.rejectedWith(
                    "Failed to find lldb-dap within Xcode Swift toolchain '/Applications/Xcode.app':\nUh oh!"
                );
            });
        });

        suite("Linux", () => {
            setup(() => {
                mockedProcess.platform = "linux";
            });

            test("returns the path to lldb-dap if it exists within the toolchain", async () => {
                mockFS({
                    "/toolchains/swift-6.0.0/usr/bin": {
                        "lldb-dap": mockFS.file({ mode: 0o770 }),
                    },
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath: "/toolchains/swift-6.0.0/usr/bin",
                    toolchainPath: "/toolchains/swift-6.0.0",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equal(
                    "/toolchains/swift-6.0.0/usr/bin/lldb-dap"
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
                mockedProcess.platform = "win32";
            });

            test("returns the path to lldb-dap.exe if it exists within the toolchain", async () => {
                mockFS({
                    "/toolchains/swift-6.0.0/usr/bin": {
                        "lldb-dap.exe": mockFS.file({ mode: 0o770 }),
                    },
                });
                const sut = createSwiftToolchain({
                    swiftFolderPath: "/toolchains/swift-6.0.0/usr/bin",
                    toolchainPath: "/toolchains/swift-6.0.0",
                });

                await expect(sut.getLLDBDebugAdapter()).to.eventually.equal(
                    "/toolchains/swift-6.0.0/usr/bin/lldb-dap.exe"
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

    suite("getProjectTemplates()", () => {
        function createSwiftToolchain(swiftVersion: Version): SwiftToolchain {
            return new SwiftToolchain(
                /* swiftFolderPath */ "/usr/bin",
                /* toolchainPath */ "/usr/bin",
                /* targetInfo */ {
                    compilerVersion: swiftVersion.toString(),
                    paths: {
                        runtimeLibraryPaths: [],
                    },
                },
                swiftVersion,
                /* runtimePath */ undefined,
                /* defaultSDK */ undefined,
                /* customSDK */ undefined,
                /* xcTestPath */ undefined,
                /* swiftTestingPath */ undefined,
                /* swiftPMTestingHelperPath */ undefined
            );
        }

        test("parses Swift PM output from v6.0.0", async () => {
            mockedUtilities.execSwift.resolves({
                stdout: `OVERVIEW: Initialize a new package

USAGE: swift package init [--type <type>] [--enable-xctest] [--disable-xctest] [--enable-swift-testing] [--disable-swift-testing] [--name <name>]

OPTIONS:
  --type <type>           Package type: (default: library)
        library           - A package with a library.
        executable        - A package with an executable.
        tool              - A package with an executable that uses
                            Swift Argument Parser. Use this template if you
                            plan to have a rich set of command-line arguments.
        build-tool-plugin - A package that vends a build tool plugin.
        command-plugin    - A package that vends a command plugin.
        macro             - A package that vends a macro.
        empty             - An empty package with a Package.swift manifest.
  --enable-xctest/--disable-xctest
                          Enable support for XCTest
  --enable-swift-testing/--disable-swift-testing
                          Enable support for Swift Testing
  --name <name>           Provide custom package name
  --version               Show the version.
  -h, -help, --help       Show help information.

`,
                stderr: "",
            });
            const sut = createSwiftToolchain(new Version(6, 0, 0));

            await expect(sut.getProjectTemplates()).to.eventually.include.deep.ordered.members([
                { id: "library", name: "Library", description: "A package with a library." },
                {
                    id: "executable",
                    name: "Executable",
                    description: "A package with an executable.",
                },
                {
                    id: "tool",
                    name: "Tool",
                    description:
                        "A package with an executable that uses Swift Argument Parser. Use this template if you plan to have a rich set of command-line arguments.",
                },
                {
                    id: "build-tool-plugin",
                    name: "Build Tool Plugin",
                    description: "A package that vends a build tool plugin.",
                },
                {
                    id: "command-plugin",
                    name: "Command Plugin",
                    description: "A package that vends a command plugin.",
                },
                { id: "macro", name: "Macro", description: "A package that vends a macro." },
                {
                    id: "empty",
                    name: "Empty",
                    description: "An empty package with a Package.swift manifest.",
                },
            ] satisfies SwiftProjectTemplate[]);
        });

        test("returns an empty array on Swift versions prior to 5.8.0", async () => {
            mockedUtilities.execSwift.rejects("unknown package command 'init'");
            const sut = createSwiftToolchain(new Version(5, 7, 9));

            await expect(sut.getProjectTemplates()).to.eventually.be.an("array").that.is.empty;
        });
    });
});
