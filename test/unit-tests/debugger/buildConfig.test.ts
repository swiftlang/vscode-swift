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
import * as sinon from "sinon";

import { FolderContext } from "@src/FolderContext";
import { LinuxMain } from "@src/LinuxMain";
import { SwiftPackage } from "@src/SwiftPackage";
import configuration, { FolderConfiguration } from "@src/configuration";
import { BuildConfigurationFactory } from "@src/debugger/buildConfig";
import { BuildFlags } from "@src/toolchain/BuildFlags";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Version } from "@src/utilities/version";

import { MockedObject, instance, mockGlobalValue, mockObject } from "../../MockUtils";

suite("BuildConfig Test Suite", () => {
    let mockedFolderContext: MockedObject<FolderContext>;
    let mockedSwiftPackage: MockedObject<SwiftPackage>;
    let mockedToolchain: MockedObject<SwiftToolchain>;
    let mockedBuildFlags: MockedObject<BuildFlags>;

    const additionalTestArgumentsConfig = mockGlobalValue(configuration, "folder");

    function createMockFolderConfig(additionalTestArguments: string[]): FolderConfiguration {
        return {
            testEnvironmentVariables: {},
            additionalTestArguments,
            searchSubfoldersForPackages: false,
            ignoreSearchingForPackagesInSubfolders: [],
            autoGenerateLaunchConfigurations: false,
            disableAutoResolve: false,
            attachmentsPath: "",
            disableSwiftlyInstallPrompt: false,
            ignoreSwiftVersionFile: false,
            pluginPermissions: () => ({ trusted: false }),
            pluginArguments: () => [],
        } as FolderConfiguration;
    }

    suiteSetup(() => {
        mockedBuildFlags = mockObject<BuildFlags>({
            getDarwinTarget: () => undefined,
        });

        mockedToolchain = mockObject<SwiftToolchain>({
            buildFlags: instance(mockedBuildFlags),
            swiftVersion: new Version(6, 0, 0),
            sanitizer: () => undefined,
        });

        mockedSwiftPackage = mockObject<SwiftPackage>({
            getTargets: sinon.stub().resolves([{ name: "TestTarget" }]),
            name: Promise.resolve("TestPackage"),
        });

        mockedFolderContext = mockObject<FolderContext>({
            toolchain: instance(mockedToolchain),
            swiftPackage: instance(mockedSwiftPackage),
            workspaceFolder: { uri: { fsPath: "/test/workspace" }, name: "TestWorkspace" } as any,
            swiftVersion: new Version(6, 0, 0),
            relativePath: "",
            linuxMain: {
                exists: true,
            } as any as LinuxMain,
        });
    });

    suite("TEST_ONLY_ARGUMENTS filtering", () => {
        let filterArgumentsSpy: sinon.SinonSpy;

        setup(() => {
            // Reset any existing spies
            sinon.restore();

            // Spy on the BuildFlags.filterArguments method
            filterArgumentsSpy = sinon.spy(BuildFlags, "filterArguments");

            // Mock configuration.folder to return test arguments
            additionalTestArgumentsConfig.setValue(() => createMockFolderConfig([]));
        });

        teardown(() => {
            sinon.restore();
        });

        test("filters out test-only arguments for test builds", async () => {
            additionalTestArgumentsConfig.setValue(() =>
                createMockFolderConfig([
                    "--no-parallel",
                    "--filter",
                    "TestCase",
                    "--enable-code-coverage",
                ])
            );

            const config = await BuildConfigurationFactory.buildAll(
                instance(mockedFolderContext),
                true, // isTestBuild
                false // isRelease
            );

            expect(filterArgumentsSpy).to.have.been.calledOnce;
            const [args] = filterArgumentsSpy.firstCall.args;

            expect(args).to.deep.equal([
                "--no-parallel",
                "--filter",
                "TestCase",
                "--enable-code-coverage",
            ]);

            expect(config.args).to.include("--build-tests");
        });

        test("preserves build-compatible arguments for test builds", async () => {
            additionalTestArgumentsConfig.setValue(() =>
                createMockFolderConfig([
                    "--scratch-path",
                    "/tmp/build",
                    "-Xswiftc",
                    "-enable-testing",
                ])
            );

            // Act: Build configuration for test build
            await BuildConfigurationFactory.buildAll(
                instance(mockedFolderContext),
                true, // isTestBuild
                false // isRelease
            );

            expect(filterArgumentsSpy).to.have.been.calledOnce;
            const [args] = filterArgumentsSpy.firstCall.args;
            expect(args).to.deep.equal([
                "--scratch-path",
                "/tmp/build",
                "-Xswiftc",
                "-enable-testing",
            ]);
        });

        test("does not filter arguments for non-test builds", async () => {
            additionalTestArgumentsConfig.setValue(() =>
                createMockFolderConfig(["--no-parallel", "--scratch-path", "/tmp/build"])
            );

            await BuildConfigurationFactory.buildAll(
                instance(mockedFolderContext),
                false, // isTestBuild
                false // isRelease
            );

            expect(filterArgumentsSpy).to.not.have.been.called;
        });

        test("handles empty additionalTestArguments", async () => {
            additionalTestArgumentsConfig.setValue(() => createMockFolderConfig([]));

            await BuildConfigurationFactory.buildAll(
                instance(mockedFolderContext),
                true, // isTestBuild
                false // isRelease
            );

            expect(filterArgumentsSpy).to.have.been.calledOnce;
            const [args] = filterArgumentsSpy.firstCall.args;
            expect(args).to.deep.equal([]);
        });

        test("handles mixed arguments correctly", async () => {
            additionalTestArgumentsConfig.setValue(() =>
                createMockFolderConfig([
                    "--no-parallel", // test-only (should be filtered out)
                    "--scratch-path",
                    "/tmp", // build-compatible (should be preserved)
                    "--filter",
                    "MyTest", // test-only (should be filtered out)
                    "-Xswiftc",
                    "-O", // build-compatible (should be preserved)
                    "--enable-code-coverage", // test-only (should be filtered out)
                    "--verbose", // build-compatible (should be preserved)
                ])
            );

            await BuildConfigurationFactory.buildAll(
                instance(mockedFolderContext),
                true, // isTestBuild
                false // isRelease
            );

            expect(filterArgumentsSpy).to.have.been.calledOnce;
            const [args] = filterArgumentsSpy.firstCall.args;
            expect(args).to.deep.equal([
                "--no-parallel",
                "--scratch-path",
                "/tmp",
                "--filter",
                "MyTest",
                "-Xswiftc",
                "-O",
                "--enable-code-coverage",
                "--verbose",
            ]);
        });

        test("has correct include values for arguments with parameters", () => {
            // Access the private static property through the class
            const filter = (BuildConfigurationFactory as any).TEST_ONLY_ARGUMENTS;

            // Arguments that take 1 parameter
            const oneParamArgs = ["--filter", "--skip", "--num-workers", "--xunit-output"];
            oneParamArgs.forEach(arg => {
                const filterItem = filter.find((f: any) => f.argument === arg);
                expect(filterItem, `${arg} should be in exclusion filter`).to.exist;
                expect(filterItem.include, `${arg} should exclude 1 parameter`).to.equal(1);
            });

            // Arguments that take no parameters (flags)
            const noParamArgs = ["--parallel", "--no-parallel", "--list-tests"];
            noParamArgs.forEach(arg => {
                const filterItem = filter.find((f: any) => f.argument === arg);
                expect(filterItem, `${arg} should be in exclusion filter`).to.exist;
                expect(filterItem.include, `${arg} should exclude 0 parameters`).to.equal(0);
            });
        });

        test("excludes expected test-only arguments", () => {
            // Access the private static property through the class
            const filter = (BuildConfigurationFactory as any).TEST_ONLY_ARGUMENTS;

            expect(filter).to.be.an("array");

            // Verify test-only arguments are included in the exclusion list
            expect(filter.some((f: any) => f.argument === "--no-parallel")).to.be.true;
            expect(filter.some((f: any) => f.argument === "--parallel")).to.be.true;
            expect(filter.some((f: any) => f.argument === "--filter")).to.be.true;
            expect(filter.some((f: any) => f.argument === "--skip")).to.be.true;
            expect(filter.some((f: any) => f.argument === "--list-tests")).to.be.true;
            expect(filter.some((f: any) => f.argument === "--attachments-path")).to.be.true;
            expect(filter.some((f: any) => f.argument === "--enable-testable-imports")).to.be.true;
            expect(filter.some((f: any) => f.argument === "--xunit-output")).to.be.true;
        });

        test("does not exclude build-compatible arguments", () => {
            // Access the private static property through the class
            const filter = (BuildConfigurationFactory as any).TEST_ONLY_ARGUMENTS;

            // Verify build-compatible arguments are NOT in the exclusion list
            expect(filter.some((f: any) => f.argument === "--scratch-path")).to.be.false;
            expect(filter.some((f: any) => f.argument === "-Xswiftc")).to.be.false;
            expect(filter.some((f: any) => f.argument === "--build-system")).to.be.false;
            expect(filter.some((f: any) => f.argument === "--sdk")).to.be.false;
            expect(filter.some((f: any) => f.argument === "--verbose")).to.be.false;
            expect(filter.some((f: any) => f.argument === "--configuration")).to.be.false;
        });
    });
});
