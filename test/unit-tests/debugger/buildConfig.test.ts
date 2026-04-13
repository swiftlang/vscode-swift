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
import { TestKind } from "@src/TestExplorer/TestKind";
import { TestLibrary } from "@src/TestExplorer/TestRunner";
import { WorkspaceContext } from "@src/WorkspaceContext";
import configuration, { FolderConfiguration } from "@src/configuration";
import {
    BuildConfigurationFactory,
    TestingConfigurationFactory,
    effectiveBuildSystem,
    groupTestsByTarget,
} from "@src/debugger/buildConfig";
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

    suite("effectiveBuildSystem", () => {
        test("returns native for Swift < 6.4.0", () => {
            expect(effectiveBuildSystem(new Version(6, 3, 0), [])).to.equal("native");
        });

        test("returns swiftbuild for Swift >= 6.4.0", () => {
            expect(effectiveBuildSystem(new Version(6, 4, 0), [])).to.equal("swiftbuild");
        });

        test("returns swiftbuild for Swift > 6.4.0", () => {
            expect(effectiveBuildSystem(new Version(7, 0, 0), [])).to.equal("swiftbuild");
        });

        test("explicit --build-system native overrides 6.4.0+ default", () => {
            expect(
                effectiveBuildSystem(new Version(6, 4, 0), ["--build-system", "native"])
            ).to.equal("native");
        });

        test("explicit --build-system swiftbuild overrides < 6.4.0 default", () => {
            expect(
                effectiveBuildSystem(new Version(6, 3, 0), ["--build-system", "swiftbuild"])
            ).to.equal("swiftbuild");
        });

        test("equals format --build-system=swiftbuild overrides < 6.4.0 default", () => {
            expect(
                effectiveBuildSystem(new Version(6, 3, 0), ["--build-system=swiftbuild"])
            ).to.equal("swiftbuild");
        });

        test("equals format --build-system=native overrides 6.4.0+ default", () => {
            expect(effectiveBuildSystem(new Version(6, 4, 0), ["--build-system=native"])).to.equal(
                "native"
            );
        });

        test("last --build-system wins across mixed formats", () => {
            expect(
                effectiveBuildSystem(new Version(6, 4, 0), [
                    "--build-system=swiftbuild",
                    "--build-system",
                    "native",
                ])
            ).to.equal("native");
            expect(
                effectiveBuildSystem(new Version(6, 4, 0), [
                    "--build-system",
                    "native",
                    "--build-system=swiftbuild",
                ])
            ).to.equal("swiftbuild");
        });

        test("last --build-system wins when duplicated", () => {
            expect(
                effectiveBuildSystem(new Version(6, 4, 0), [
                    "--build-system",
                    "swiftbuild",
                    "--build-system",
                    "native",
                ])
            ).to.equal("native");
        });

        test("ignores --build-system with no following value", () => {
            expect(effectiveBuildSystem(new Version(6, 4, 0), ["--build-system"])).to.equal(
                "swiftbuild"
            );
        });

        test("ignores --build-system with unrecognized value", () => {
            expect(
                effectiveBuildSystem(new Version(6, 4, 0), ["--build-system", "xcodebuild"])
            ).to.equal("swiftbuild");
        });
    });

    suite("groupTestsByTarget", () => {
        test("empty array returns empty map", () => {
            const result = groupTestsByTarget([]);
            expect(result).to.deep.equal(new Map());
        });

        test("single target, single test", () => {
            const result = groupTestsByTarget(["FooTests.Bar.baz"]);
            expect(result.get("FooTests")).to.deep.equal(["FooTests.Bar.baz"]);
        });

        test("multiple targets grouped correctly", () => {
            const result = groupTestsByTarget([
                "FooTests.Bar.baz",
                "BarTests.Qux.quux",
                "FooTests.Other.test",
            ]);
            expect(result.get("FooTests")).to.deep.equal([
                "FooTests.Bar.baz",
                "FooTests.Other.test",
            ]);
            expect(result.get("BarTests")).to.deep.equal(["BarTests.Qux.quux"]);
        });

        test("target-level wildcard", () => {
            const result = groupTestsByTarget(["FooTests.*"]);
            expect(result.get("FooTests")).to.deep.equal(["FooTests.*"]);
        });

        test("bare target name without dot", () => {
            const result = groupTestsByTarget(["FooTests"]);
            expect(result.get("FooTests")).to.deep.equal(["FooTests"]);
        });

        test("remaps c99 target name to original target name", () => {
            const c99ToName = new Map([["My_Target", "My-Target"]]);
            const result = groupTestsByTarget(["My_Target.SomeTests.test"], c99ToName);
            expect(result.get("My-Target")).to.deep.equal(["My_Target.SomeTests.test"]);
        });

        test("uses c99 name as-is when no mapping provided", () => {
            const result = groupTestsByTarget(["My_Target.SomeTests.test"]);
            expect(result.get("My_Target")).to.deep.equal(["My_Target.SomeTests.test"]);
        });

        test("falls back to c99 name when not present in map", () => {
            const c99ToName = new Map([["Other_Target", "Other-Target"]]);
            const result = groupTestsByTarget(["My_Target.SomeTests.test"], c99ToName);
            expect(result.get("My_Target")).to.deep.equal(["My_Target.SomeTests.test"]);
        });
    });

    suite("testExecutableOutputPath", () => {
        const platformMock = mockGlobalValue(process, "platform");
        const buildArgumentsConfig = mockGlobalValue(configuration, "buildArguments");
        let mockedLogger: MockedObject<Pick<WorkspaceContext["logger"], "warn">>;

        function createTestFolderContext(
            swiftVersion: Version,
            binPath: string
        ): MockedObject<FolderContext> {
            mockedLogger = mockObject<Pick<WorkspaceContext["logger"], "warn">>({
                warn: () => {},
            });
            const testBuildFlags = mockObject<BuildFlags>({
                getBuildBinaryPath: sinon.stub().resolves(binPath),
            });
            const testToolchain = mockObject<SwiftToolchain>({
                buildFlags: instance(testBuildFlags),
                swiftVersion: swiftVersion,
                unversionedTriple: undefined,
            });
            const testSwiftPackage = mockObject<SwiftPackage>({
                getTargets: sinon.stub().resolves([{ name: "PackageTests" }]),
                name: Promise.resolve("MyPackage"),
            });
            return mockObject<FolderContext>({
                toolchain: instance(testToolchain),
                swiftPackage: instance(testSwiftPackage),
                workspaceFolder: {
                    uri: { fsPath: "/test/workspace" },
                    name: "TestWorkspace",
                } as any,
                workspaceContext: { logger: instance(mockedLogger) } as any,
                folder: { fsPath: "/test/workspace" } as any,
                swiftVersion: swiftVersion,
                relativePath: "",
                linuxMain: { exists: true } as any as LinuxMain,
            });
        }

        setup(() => {
            additionalTestArgumentsConfig.setValue(() => createMockFolderConfig([]));
            buildArgumentsConfig.setValue([]);
        });

        suite("with native build system (Swift < 6.4)", () => {
            const swiftVersion = new Version(6, 3, 0);

            test("uses .xctest on linux with targetName", async () => {
                platformMock.setValue("linux" as NodeJS.Platform);
                const ctx = createTestFolderContext(swiftVersion, "/build/debug");

                const result = await TestingConfigurationFactory.testExecutableOutputPath(
                    instance(ctx),
                    TestKind.debug,
                    TestLibrary.xctest,
                    "PackageTests"
                );

                expect(result).to.match(/PackageTests\.xctest$/);
            });

            test("uses .xctest on windows with targetName", async () => {
                platformMock.setValue("win32" as NodeJS.Platform);
                const ctx = createTestFolderContext(swiftVersion, "/build/debug");

                const result = await TestingConfigurationFactory.testExecutableOutputPath(
                    instance(ctx),
                    TestKind.debug,
                    TestLibrary.xctest,
                    "PackageTests"
                );

                expect(result).to.match(/PackageTests\.xctest$/);
            });

            test("uses .xctest on darwin with targetName", async () => {
                platformMock.setValue("darwin" as NodeJS.Platform);
                const ctx = createTestFolderContext(swiftVersion, "/build/debug");

                const result = await TestingConfigurationFactory.testExecutableOutputPath(
                    instance(ctx),
                    TestKind.debug,
                    TestLibrary.xctest,
                    "PackageTests"
                );

                expect(result).to.match(/PackageTests\.xctest$/);
            });
        });

        suite("with swiftbuild build system (Swift >= 6.4)", () => {
            const swiftVersion = new Version(6, 4, 0);

            test("uses -test-runner on linux with targetName", async () => {
                platformMock.setValue("linux" as NodeJS.Platform);
                const ctx = createTestFolderContext(swiftVersion, "/build/debug");

                const result = await TestingConfigurationFactory.testExecutableOutputPath(
                    instance(ctx),
                    TestKind.debug,
                    TestLibrary.xctest,
                    "PackageTests"
                );

                expect(result).to.match(/PackageTests-test-runner$/);
            });

            test("uses -test-runner.exe on windows with targetName", async () => {
                platformMock.setValue("win32" as NodeJS.Platform);
                const ctx = createTestFolderContext(swiftVersion, "/build/debug");

                const result = await TestingConfigurationFactory.testExecutableOutputPath(
                    instance(ctx),
                    TestKind.debug,
                    TestLibrary.xctest,
                    "PackageTests"
                );

                expect(result).to.match(/PackageTests-test-runner\.exe$/);
            });

            test("uses .xctest on darwin with targetName", async () => {
                platformMock.setValue("darwin" as NodeJS.Platform);
                const ctx = createTestFolderContext(swiftVersion, "/build/debug");

                const result = await TestingConfigurationFactory.testExecutableOutputPath(
                    instance(ctx),
                    TestKind.debug,
                    TestLibrary.xctest,
                    "PackageTests"
                );

                expect(result).to.match(/PackageTests\.xctest$/);
            });

            test("uses -test-runner on linux without targetName", async () => {
                platformMock.setValue("linux" as NodeJS.Platform);
                const ctx = createTestFolderContext(swiftVersion, "/build/debug");

                const result = await TestingConfigurationFactory.testExecutableOutputPath(
                    instance(ctx),
                    TestKind.debug,
                    TestLibrary.xctest
                );

                expect(result).to.match(/MyPackagePackageTests-test-runner$/);
            });

            test("uses -test-runner on linux for swift-testing", async () => {
                platformMock.setValue("linux" as NodeJS.Platform);
                const ctx = createTestFolderContext(swiftVersion, "/build/debug");

                const result = await TestingConfigurationFactory.testExecutableOutputPath(
                    instance(ctx),
                    TestKind.debug,
                    TestLibrary.swiftTesting,
                    "PackageTests"
                );

                expect(result).to.match(/PackageTests-test-runner$/);
            });
        });

        suite("with explicit --build-system override", () => {
            test("uses -test-runner when --build-system swiftbuild on old Swift", async () => {
                platformMock.setValue("linux" as NodeJS.Platform);
                buildArgumentsConfig.setValue(["--build-system", "swiftbuild"]);
                const ctx = createTestFolderContext(new Version(6, 3, 0), "/build/debug");

                const result = await TestingConfigurationFactory.testExecutableOutputPath(
                    instance(ctx),
                    TestKind.debug,
                    TestLibrary.xctest,
                    "PackageTests"
                );

                expect(result).to.match(/PackageTests-test-runner$/);
            });

            test("uses .xctest when --build-system native on new Swift", async () => {
                platformMock.setValue("linux" as NodeJS.Platform);
                buildArgumentsConfig.setValue(["--build-system", "native"]);
                const ctx = createTestFolderContext(new Version(6, 4, 0), "/build/debug");

                const result = await TestingConfigurationFactory.testExecutableOutputPath(
                    instance(ctx),
                    TestKind.debug,
                    TestLibrary.xctest,
                    "PackageTests"
                );

                expect(result).to.match(/PackageTests\.xctest$/);
            });
        });
    });
});
