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
import * as assert from "assert";
import { expect } from "chai";
import { match } from "sinon";
import * as vscode from "vscode";

import { Environment } from "@src/services/Environment";
import { Shell } from "@src/services/Shell";
import { Swiftly, SwiftlyCLI } from "@src/swiftly/Swiftly";
import { SwiftlyError, SwiftlyErrorCode } from "@src/swiftly/SwiftlyError";
import { AvailableToolchain } from "@src/swiftly/types";
import { Result } from "@src/utilities/result";

import { MockedObject, inMemoryFileSystem, instance, mockFn, mockObject } from "../../MockUtils";
import { NullLogger } from "../../utilities/NullLogger";

suite("SwiftlyService Unit Tests", () => {
    const mockedFS = inMemoryFileSystem();
    let mockedEnvironment: MockedObject<Environment>;
    let mockedShell: MockedObject<Shell>;
    let mockedWindow: MockedObject<typeof vscode.window>;
    let sut: Swiftly;

    setup(() => {
        mockedEnvironment = mockObject<Environment>({
            platform: "darwin",
            env: mockFn(s => s.returns({})),
        });
        mockedShell = mockObject<Shell>({
            execFile: mockFn(s => s.rejects("execFile() was not properly mocked for the test.")),
            execFileStreamOutput: mockFn(s =>
                s.rejects("execFileStreamOutput() was not properly mocked for the test.")
            ),
        });
        mockedWindow = mockObject<typeof vscode.window>({
            showInformationMessage: mockFn(),
            showWarningMessage: mockFn(),
            showErrorMessage: mockFn(),
            createOutputChannel: mockFn(s =>
                s.returns(
                    mockObject<vscode.OutputChannel>({
                        show: mockFn(),
                        appendLine: mockFn(),
                    })
                )
            ),
        });
        sut = new SwiftlyCLI(
            mockedFS,
            mockedEnvironment,
            mockedShell,
            instance(mockedWindow),
            new NullLogger()
        );
    });

    function assertSwiftlyError(
        name: string,
        result: Result<any, SwiftlyError>,
        code: SwiftlyErrorCode
    ) {
        assert(result.error, `Expected ${name} to return an error, but it succeeded.`);
        expect(result.error, `Expected ${name} to return a ${code} error.`)
            .to.have.property("code")
            .that.equals(code);
    }

    test("returns an OS_NOT_SUPPORTED error when running on Windows", async () => {
        // GIVEN we're running on Windows
        mockedEnvironment.platform = "win32";

        // WHEN any Swiftly command is issued
        const results: { [key: string]: Result<any, SwiftlyError> } = {
            "version()": await sut.version(),
            "getActiveToolchain()": await sut.getActiveToolchain(""),
            "getInstalledToolchains()": await sut.getInstalledToolchains(),
            "getAvailableToolchains()": await sut.getAvailableToolchains(),
            "use()": await sut.use("6.2.0"),
            "installToolchain()": await sut.installToolchain("6.2.0"),
        };

        // THEN an OS_NOT_SUPPORTED error should be returned
        Object.getOwnPropertyNames(results).forEach(method => {
            assertSwiftlyError(method, results[method], SwiftlyErrorCode.OS_NOT_SUPPORTED);
        });
    });

    test("returns a NOT_INSTALLED error if Swiftly is not installed", async () => {
        // GIVEN that running a Swiftly command throws an ENOENT error
        mockedShell.execFile.withArgs("swiftly").rejects({ code: "ENOENT" });

        // WHEN any Swiftly command is issued
        const results: { [key: string]: Result<any, SwiftlyError> } = {
            "version()": await sut.version(),
            "getActiveToolchain()": await sut.getActiveToolchain(""),
            "getInstalledToolchains()": await sut.getInstalledToolchains(),
            "getAvailableToolchains()": await sut.getAvailableToolchains(),
            "use()": await sut.use("6.2.0"),
            "installToolchain()": await sut.installToolchain("6.2.0"),
        };

        // THEN a NOT_INSTALLED error should be returned
        Object.getOwnPropertyNames(results).forEach(method => {
            assertSwiftlyError(method, results[method], SwiftlyErrorCode.NOT_INSTALLED);
        });
    });

    suite("Version 1.0.1", () => {
        setup(() => {
            // All tests in this sub-suite assume that the Swiftly verion is 1.0.1
            mockedShell.execFile
                .withArgs("swiftly", ["--version"])
                .resolves({ stdout: "1.0.1\n", stderr: "" });
        });

        test("getInstalledToolchains() returns installed toolchains from the Swiftly configuration file", async () => {
            // GIVEN the environment variable $SWIFTLY_HOME_DIR exists
            //   AND a configuration file exists in the $SWIFTLY_HOME_DIR directory
            mockedEnvironment.env.returns({ SWIFTLY_HOME_DIR: "/home/.swiftly" });
            await mockedFS.mkdir("/home/.swiftly", { recursive: true });
            await mockedFS.writeFile(
                "/home/.swiftly/config.json",
                JSON.stringify({
                    installedToolchains: ["swift-6.2"],
                })
            );

            // WHEN swiftly.listAvailableToolchains() is called
            const toolchains = (await sut.getInstalledToolchains()).getOrThrow();

            // THEN a list of toolchains from the config should be returned
            expect(toolchains).to.deep.equal(["swift-6.2"]);
        });

        test("getAvailableToolchains() returns a METHOD_NOT_SUPPORTED error", async () => {
            // WHEN getAvailableToolchains() is called
            const result = await sut.getAvailableToolchains();

            // THEN a METHOD_NOT_SUPPORTED error is returned
            expect(result.error).to.have.property("code", SwiftlyErrorCode.METHOD_NOT_SUPPORTED);
        });

        test("use() instructs Swiftly to use a particular toolchain", async () => {
            // GIVEN "swiftly use <toolchain>" completes succesfully
            mockedShell.execFile
                .withArgs("swiftly", match.array.startsWith(["use"]))
                .resolves({ stdout: "", stderr: "" });

            // WHEN use() is called with "6.2.0"
            (await sut.use("6.2.0")).getOrThrow();

            // THEN "swiftly use 6.2.0" should have been called
            expect(mockedShell.execFile).to.have.been.calledWith("swiftly", ["use", "6.2.0"]);
        });

        test("getActiveToolchain() finds the active toolchain from the Swiftly config", async () => {
            // GIVEN the environment variable $SWIFTLY_HOME_DIR exists
            //   AND a configuration file exists in the $SWIFTLY_HOME_DIR directory
            //   AND "swiftly use --print-location" returns "/home/.swiftly/toolchains/6.2.0"
            mockedEnvironment.env.returns({ SWIFTLY_HOME_DIR: "/home/.swiftly" });
            await mockedFS.mkdir("/home/.swiftly", { recursive: true });
            await mockedFS.writeFile(
                "/home/.swiftly/config.json",
                JSON.stringify({
                    installedToolchains: ["6.2"],
                    inUse: "6.2",
                })
            );
            mockedShell.execFile
                .withArgs("swiftly", ["use", "--print-location"])
                .resolves({ stdout: "/home/.swiftly/toolchains/6.2.0\n", stderr: "" });

            // WHEN installToolchain() is called
            const result = (await sut.getActiveToolchain("")).getOrThrow();

            // THEN a METHOD_NOT_SUPPORTED error is returned
            expect(result).to.deep.equal({
                name: "6.2",
                location: "/home/.swiftly/toolchains/6.2.0",
            });
        });

        test("installToolchain() returns a METHOD_NOT_SUPPORTED error", async () => {
            // WHEN installToolchain() is called
            const result = await sut.installToolchain("6.2.0");

            // THEN a METHOD_NOT_SUPPORTED error is returned
            expect(result.error).to.have.property("code", SwiftlyErrorCode.METHOD_NOT_SUPPORTED);
        });
    });

    suite("Version 1.1.0", () => {
        setup(() => {
            // All tests in this sub-suite assume that the Swiftly verion is 1.1.0
            mockedShell.execFile.withArgs("swiftly", ["--version"]).resolves({
                stdout: "1.1.0\n",
                stderr: "",
            });
        });

        test("getInstalledToolchains() returns installed toolchains using Swiftly's JSON output format", async () => {
            // GIVEN "swiftly list --format=json" returns a JSON formatted list of installed toolchains
            mockedShell.execFile.withArgs("swiftly", ["list", "--format=json"]).resolves({
                stdout: JSON.stringify({
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
                            inUse: false,
                            isDefault: false,
                            version: {
                                branch: "6.2",
                                date: "2025-08-21",
                                major: 6,
                                minor: 2,
                                name: "6.2-snapshot-2025-08-21",
                                type: "snapshot",
                            },
                        },
                        {
                            inUse: true,
                            isDefault: true,
                            version: {
                                major: 6,
                                minor: 2,
                                name: "6.2.0",
                                patch: 0,
                                type: "stable",
                            },
                        },
                        {
                            inUse: false,
                            isDefault: false,
                            version: {
                                major: 6,
                                minor: 1,
                                name: "6.1.2",
                                patch: 2,
                                type: "stable",
                            },
                        },
                    ],
                }),
                stderr: "",
            });

            // WHEN getInstalledToolchains() is called
            const result = (await sut.getInstalledToolchains()).getOrThrow();

            // THEN an array of installed toolchains should be returned
            expect(result).to.deep.equal(["xcode", "6.2-snapshot-2025-08-21", "6.2.0", "6.1.2"]);
        });

        test("getInstalledToolchains() is resilient to non-breaking JSON output changes", async () => {
            // GIVEN "swiftly list --format=json" returns a JSON formatted list of installed toolchains
            //   AND this output contains extra key value pairs
            mockedShell.execFile.withArgs("swiftly", ["list", "--format=json"]).resolves({
                stdout: JSON.stringify({
                    newProperty: "new!", // Add an extra property
                    toolchains: [
                        {
                            inUse: false,
                            isDefault: false,
                            newProperty: "new!", // Add an extra property
                            version: {
                                // the "special" type doesn't normally exist
                                type: "special",
                                name: "special",
                            },
                        },
                        {
                            inUse: false,
                            isDefault: false,
                            newProperty: "new!", // Add an extra property
                            version: {
                                type: "snapshot",
                                name: "6.2-snapshot-2025-08-21",
                                branch: "6.2",
                                date: "2025-08-21",
                                major: 6,
                                minor: 2,
                                newProperty: "new!", // Add an extra property
                            },
                        },
                    ],
                }),
                stderr: "",
            });

            // WHEN getInstalledToolchains() is called
            const result = (await sut.getInstalledToolchains()).getOrThrow();

            // THEN an array of installed toolchains should be returned
            expect(result).to.deep.equal(["special", "6.2-snapshot-2025-08-21"]);
        });

        test("getAvailableToolchains() returns available toolchains using Swiftly's JSON output format", async () => {
            // GIVEN "swiftly list-available --format=json" returns a JSON formatted list of installed toolchains
            const availableToolchains: AvailableToolchain[] = [
                {
                    inUse: true,
                    installed: true,
                    isDefault: true,
                    version: {
                        major: 6,
                        minor: 2,
                        name: "6.2.0",
                        patch: 0,
                        type: "stable",
                    },
                },
                {
                    inUse: false,
                    installed: false,
                    isDefault: false,
                    version: {
                        major: 6,
                        minor: 1,
                        name: "6.1.3",
                        patch: 3,
                        type: "stable",
                    },
                },
                {
                    inUse: false,
                    installed: true,
                    isDefault: false,
                    version: {
                        major: 6,
                        minor: 1,
                        name: "6.1.2",
                        patch: 2,
                        type: "stable",
                    },
                },
            ];
            mockedShell.execFile.withArgs("swiftly", ["list-available", "--format=json"]).resolves({
                stdout: JSON.stringify({
                    toolchains: availableToolchains,
                }),
                stderr: "",
            });

            // WHEN getAvailableToolchains() is called
            const result = (await sut.getAvailableToolchains()).getOrThrow();

            // THEN an array of available toolchains should be returned
            expect(result).to.deep.equal(availableToolchains);
        });

        test("getAvailableToolchains() is resilient to non-breaking JSON output changes", async () => {
            // GIVEN "swiftly list-available --format=json" returns a JSON formatted list of installed toolchains
            //   AND this output contains extra key value pairs
            mockedShell.execFile.withArgs("swiftly", ["list-available", "--format=json"]).resolves({
                stdout: JSON.stringify({
                    newProperty: "new!", // Add an extra property
                    toolchains: [
                        {
                            inUse: true,
                            installed: true,
                            isDefault: true,
                            newProperty: "new!", // Add an extra property
                            version: {
                                type: "stable",
                                name: "6.2.0",
                                major: 6,
                                minor: 2,
                                patch: 0,
                                newProperty: "new!", // Add an extra property
                            },
                        },
                    ],
                }),
                stderr: "",
            });

            // WHEN getAvailableToolchains() is called
            const result = (await sut.getAvailableToolchains()).getOrThrow();

            // THEN an array of available toolchains should be returned
            expect(result).to.deep.equal([
                {
                    inUse: true,
                    installed: true,
                    isDefault: true,
                    version: {
                        type: "stable",
                        name: "6.2.0",
                        major: 6,
                        minor: 2,
                        patch: 0,
                    },
                },
            ]);
        });

        test("installToolchain() invokes 'swiftly install <toolchain>'", async () => {
            // GIVEN "swiftly install" succeeds
            mockedShell.execFile
                .withArgs("swiftly", match.array.startsWith(["install"]))
                .resolves({ stdout: "", stderr: "" });

            // WHEN installToolchain() is called with "6.2.0"
            (await sut.installToolchain("6.2.0")).getOrThrow();

            // THEN "swiftly install 6.2.0" should have been called
            expect(mockedShell.execFile).to.have.been.calledWith(
                "swiftly",
                match.array.startsWith(["install", "6.2.0"])
            );
        });

        test("installToolchain() runs the post install script on Linux", async () => {
            // GIVEN we're running in Linux
            //   AND the user accepts all VSCode dialogs
            //   AND "swiftly install" creates a post install script
            //   AND the user accepts the confirmation dialog
            //   AND chmod succeeds
            //   AND pkexec succeeds
            mockedEnvironment.platform = "linux";
            let postInstallScriptLocation: string | undefined = undefined;
            mockedShell.execFile
                .withArgs("swiftly", match.array.startsWith(["install"]))
                .callsFake(async (_executable, args) => {
                    // Intercept the post install script
                    const indexOfPostInstallArg = args.findIndex(a => a === "--post-install-file");
                    expect(
                        indexOfPostInstallArg,
                        "Unable to find --post-install-script"
                    ).to.be.greaterThanOrEqual(0);
                    postInstallScriptLocation = args[indexOfPostInstallArg + 1];
                    await mockedFS.writeFile(
                        postInstallScriptLocation,
                        "apt-get -y install sql-lite\n",
                        "utf-8"
                    );
                    return { stdout: "", stderr: "" };
                });
            mockedWindow.showWarningMessage.resolves("Execute Script" as any);
            mockedShell.execFile.withArgs("chmod").resolves({ stdout: "", stderr: "" });
            mockedShell.execFileStreamOutput.withArgs("pkexec").resolves();

            // WHEN installToolchain() is called with "6.2.0"
            (await sut.installToolchain("6.2.0")).getOrThrow();

            // THEN "swiftly install 6.2.0" should have been called
            //  AND the post install script should have been executed
            expect(mockedShell.execFile).to.have.been.calledWith(
                "swiftly",
                match.array.startsWith(["install", "6.2.0"])
            );
            expect(mockedShell.execFile).to.have.been.calledWith("chmod", [
                "+x",
                postInstallScriptLocation,
            ]);
            expect(mockedShell.execFileStreamOutput).to.have.been.calledWith("pkexec", [
                postInstallScriptLocation,
            ]);
        });
    });
});
