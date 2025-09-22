//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { expect } from "chai";
import * as path from "path";
import * as sinon from "sinon";

import configuration from "@src/configuration";
import { SwiftLogger } from "@src/logging/SwiftLogger";
import { ArgumentFilter, BuildFlags } from "@src/toolchain/BuildFlags";
import { DarwinCompatibleTarget, SwiftToolchain } from "@src/toolchain/SwiftToolchain";
import * as utilities from "@src/utilities/utilities";
import { Version } from "@src/utilities/version";

import { MockedObject, instance, mockGlobalValue, mockObject } from "../../MockUtils";

suite("BuildFlags Test Suite", () => {
    const mockedPlatform = mockGlobalValue(process, "platform");
    let mockedToolchain: MockedObject<SwiftToolchain>;
    let buildFlags: BuildFlags;

    const sandboxConfig = mockGlobalValue(configuration, "disableSandbox");

    suiteSetup(() => {
        mockedToolchain = mockObject<SwiftToolchain>({
            swiftVersion: new Version(6, 0, 0),
        });
        buildFlags = new BuildFlags(instance(mockedToolchain));
    });

    setup(() => {
        mockedPlatform.setValue("darwin");
        sandboxConfig.setValue(false);
    });

    suite("getDarwinTarget", () => {
        const sdkConfig = mockGlobalValue(configuration, "sdk");

        test("iPhoneOS", () => {
            sdkConfig.setValue("/some/other/full/test/path/iPhoneOS15.0.sdk");
            expect(buildFlags.getDarwinTarget()).to.containSubset({
                target: DarwinCompatibleTarget.iOS,
                version: "15.0",
            });
        });

        test("AppleTVOS", () => {
            sdkConfig.setValue("/some/other/full/test/path/AppleTVOS4.1.2.sdk");
            expect(buildFlags.getDarwinTarget()).to.containSubset({
                target: DarwinCompatibleTarget.tvOS,
                version: "4.1.2",
            });
        });

        test("WatchOS", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS7.0.sdk");
            expect(buildFlags.getDarwinTarget()).to.containSubset({
                target: DarwinCompatibleTarget.watchOS,
                version: "7.0",
            });
        });

        test("XROS", () => {
            sdkConfig.setValue("/some/other/full/test/path/XROS2.0.sdk");
            expect(buildFlags.getDarwinTarget()).to.containSubset({
                target: DarwinCompatibleTarget.visionOS,
                version: "2.0",
            });
        });

        test("invalid name", () => {
            sdkConfig.setValue("/some/other/full/test/path/UhOh1.2.3.sdk");
            expect(buildFlags.getDarwinTarget()).to.equal(undefined);
        });
    });

    suite("swiftpmSDKFlags", () => {
        const sdkConfig = mockGlobalValue(configuration, "sdk");
        const swiftSDKConfig = mockGlobalValue(configuration, "swiftSDK");

        test("no configuration provided", () => {
            sdkConfig.setValue("");
            swiftSDKConfig.setValue("");
            expect(buildFlags.swiftpmSDKFlags()).to.be.an("array").that.is.empty;
        });

        test("configuration provided", () => {
            sdkConfig.setValue("/some/other/full/test/path");
            expect(buildFlags.swiftpmSDKFlags()).to.deep.equal([
                "--sdk",
                "/some/other/full/test/path",
            ]);
        });

        test("configuration provided for swiftSDK", () => {
            swiftSDKConfig.setValue("arm64-apple-ios");
            expect(buildFlags.swiftpmSDKFlags()).to.deep.equal(["--swift-sdk", "arm64-apple-ios"]);
        });

        test("configuration provided for swiftSDK and sdk", () => {
            sdkConfig.setValue("/some/other/full/test/path");
            swiftSDKConfig.setValue("arm64-apple-ios");
            expect(buildFlags.swiftpmSDKFlags()).to.deep.equal([
                "--sdk",
                "/some/other/full/test/path",
                "--swift-sdk",
                "arm64-apple-ios",
            ]);
        });

        test("include target", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS.sdk");
            expect(buildFlags.swiftpmSDKFlags()).to.deep.equal([
                "--sdk",
                "/some/other/full/test/path/WatchOS.sdk",
                "-Xswiftc",
                "-target",
                "-Xswiftc",
                "arm64-apple-watchos",
            ]);
        });
    });

    suite("swiftDriverSDKFlags", () => {
        const sdkConfig = mockGlobalValue(configuration, "sdk");

        test("direct", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS.sdk");
            expect(buildFlags.swiftDriverSDKFlags()).to.deep.equal([
                "-sdk",
                "/some/other/full/test/path/WatchOS.sdk",
            ]);
        });

        test("indirect", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS.sdk");
            expect(buildFlags.swiftDriverSDKFlags(true)).to.deep.equal([
                "-Xswiftc",
                "-sdk",
                "-Xswiftc",
                "/some/other/full/test/path/WatchOS.sdk",
            ]);
        });
    });

    suite("swiftDriverTargetFlags", () => {
        const sdkConfig = mockGlobalValue(configuration, "sdk");

        test("direct", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS.sdk");
            expect(buildFlags.swiftDriverTargetFlags()).to.deep.equal([
                "-target",
                "arm64-apple-watchos",
            ]);
        });

        test("indirect", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS.sdk");
            expect(buildFlags.swiftDriverTargetFlags(true)).to.deep.equal([
                "-Xswiftc",
                "-target",
                "-Xswiftc",
                "arm64-apple-watchos",
            ]);
        });
    });

    suite("buildPathFlags", () => {
        const buildPathConfig = mockGlobalValue(configuration, "buildPath");

        test("no configuration provided", () => {
            buildPathConfig.setValue("");
            expect(buildFlags.buildPathFlags()).to.be.an("array").that.is.empty;
        });

        test("configuration provided", () => {
            buildPathConfig.setValue("/some/other/full/test/path");
            expect(buildFlags.buildPathFlags()).to.deep.equal([
                "--scratch-path",
                "/some/other/full/test/path",
            ]);
        });

        test("configuration provided, before swift 5.8", () => {
            mockedToolchain.swiftVersion = new Version(5, 7, 0);
            buildPathConfig.setValue("/some/other/full/test/path");
            expect(buildFlags.buildPathFlags()).to.deep.equal([
                "--build-path",
                "/some/other/full/test/path",
            ]);
        });
    });

    suite("buildDirectoryFromWorkspacePath", () => {
        const buildPathConfig = mockGlobalValue(configuration, "buildPath");

        test("no configuration provided", () => {
            buildPathConfig.setValue("");

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false)
            ).to.equal(path.normalize(".build"));

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true)
            ).to.equal(path.normalize("/some/full/workspace/test/path/.build"));
        });

        test("absolute configuration provided", () => {
            buildPathConfig.setValue(path.normalize("/some/other/full/test/path"));

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath(
                    path.normalize("/some/full/workspace/test/path"),
                    false
                )
            ).to.equal(path.normalize("/some/other/full/test/path"));

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath(
                    path.normalize("/some/full/workspace/test/path"),
                    true
                )
            ).to.equal(path.normalize("/some/other/full/test/path"));
        });

        test("relative configuration provided", () => {
            buildPathConfig.setValue(path.normalize("some/relative/test/path"));

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false)
            ).to.equal(path.normalize("some/relative/test/path"));

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true)
            ).to.equal(path.normalize("/some/full/workspace/test/path/some/relative/test/path"));
        });
    });

    suite("withAdditionalFlags", () => {
        const sdkConfig = mockGlobalValue(configuration, "sdk");

        test("package", () => {
            for (const sub of ["dump-symbol-graph", "diagnose-api-breaking-changes", "resolve"]) {
                sdkConfig.setValue("");
                expect(
                    buildFlags.withAdditionalFlags(["package", sub, "--disable-sandbox"])
                ).to.deep.equal(["package", sub, "--disable-sandbox"]);

                sdkConfig.setValue("/some/full/path/to/sdk");
                expect(
                    buildFlags.withAdditionalFlags(["package", sub, "--disable-sandbox"])
                ).to.deep.equal([
                    "package",
                    sub,
                    "--sdk",
                    "/some/full/path/to/sdk",
                    "--disable-sandbox",
                ]);
            }

            sdkConfig.setValue("");
            expect(buildFlags.withAdditionalFlags(["package", "init"])).to.deep.equal([
                "package",
                "init",
            ]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            expect(buildFlags.withAdditionalFlags(["package", "init"])).to.deep.equal([
                "package",
                "init",
            ]);

            sandboxConfig.setValue(true);
            expect(buildFlags.withAdditionalFlags(["package", "init"])).to.deep.equal([
                "package",
                "--disable-sandbox",
                "-Xswiftc",
                "-disable-sandbox",
                "init",
            ]);
        });

        test("build", () => {
            sdkConfig.setValue("");
            expect(
                buildFlags.withAdditionalFlags(["build", "--target", "MyExecutable"])
            ).to.deep.equal(["build", "--target", "MyExecutable"]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            expect(
                buildFlags.withAdditionalFlags(["build", "--target", "MyExecutable"])
            ).to.deep.equal([
                "build",
                "--sdk",
                "/some/full/path/to/sdk",
                "--target",
                "MyExecutable",
            ]);

            sandboxConfig.setValue(true);
            expect(
                buildFlags.withAdditionalFlags(["build", "--target", "MyExecutable"])
            ).to.deep.equal([
                "build",
                "--sdk",
                "/some/full/path/to/sdk",
                "--target",
                "MyExecutable",
                "--disable-sandbox",
                "-Xswiftc",
                "-disable-sandbox",
            ]);
        });

        test("run", () => {
            sdkConfig.setValue("");
            expect(
                buildFlags.withAdditionalFlags(["run", "--product", "MyExecutable"])
            ).to.deep.equal(["run", "--product", "MyExecutable"]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            expect(
                buildFlags.withAdditionalFlags(["run", "--product", "MyExecutable"])
            ).to.deep.equal([
                "run",
                "--sdk",
                "/some/full/path/to/sdk",
                "--product",
                "MyExecutable",
            ]);

            sandboxConfig.setValue(true);
            expect(
                buildFlags.withAdditionalFlags(["run", "--product", "MyExecutable"])
            ).to.deep.equal([
                "run",
                "--sdk",
                "/some/full/path/to/sdk",
                "--product",
                "MyExecutable",
                "--disable-sandbox",
                "-Xswiftc",
                "-disable-sandbox",
            ]);
        });

        test("test", () => {
            sdkConfig.setValue("");
            expect(buildFlags.withAdditionalFlags(["test", "--filter", "MyTests"])).to.deep.equal([
                "test",
                "--filter",
                "MyTests",
            ]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            expect(buildFlags.withAdditionalFlags(["test", "--filter", "MyTests"])).to.deep.equal([
                "test",
                "--sdk",
                "/some/full/path/to/sdk",
                "--filter",
                "MyTests",
            ]);

            sandboxConfig.setValue(true);
            expect(buildFlags.withAdditionalFlags(["test", "--filter", "MyTests"])).to.deep.equal([
                "test",
                "--sdk",
                "/some/full/path/to/sdk",
                "--filter",
                "MyTests",
                "--disable-sandbox",
                "-Xswiftc",
                "-disable-sandbox",
            ]);
        });

        test("other commands", () => {
            sdkConfig.setValue("");
            expect(buildFlags.withAdditionalFlags(["help", "repl"])).to.deep.equal([
                "help",
                "repl",
            ]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            expect(buildFlags.withAdditionalFlags(["help", "repl"])).to.deep.equal([
                "help",
                "repl",
            ]);

            sandboxConfig.setValue(true);
            expect(buildFlags.withAdditionalFlags(["help", "repl"])).to.deep.equal([
                "help",
                "repl",
            ]);
        });
    });

    test("filterArguments", () => {
        function filterArguments(args: string[]): string[] {
            const argumentFilter: ArgumentFilter[] = [
                { argument: "-one", include: 1 },
                { argument: "-1", include: 1 },
                { argument: "-zero", include: 0 },
                { argument: "-two", include: 2 },
            ];
            return BuildFlags.filterArguments(args, argumentFilter);
        }
        expect(filterArguments(["-test", "this"])).to.be.an("array").that.is.empty;
        expect(filterArguments(["-test", "-zero"])).to.deep.equal(["-zero"]);
        expect(filterArguments(["-one", "inc1", "test"])).to.deep.equal(["-one", "inc1"]);
        expect(filterArguments(["-two", "inc1", "inc2"])).to.deep.equal(["-two", "inc1", "inc2"]);
        expect(filterArguments(["-ignore", "-one", "inc1", "test"])).to.deep.equal([
            "-one",
            "inc1",
        ]);
        expect(filterArguments(["-one", "inc1", "test", "-1", "inc2"])).to.deep.equal([
            "-one",
            "inc1",
            "-1",
            "inc2",
        ]);
        expect(filterArguments(["-one=1", "-zero=0", "-one1=1"])).to.deep.equal(["-one=1"]);
    });

    suite("getBuildBinaryPath", () => {
        const buildArgsConfig = mockGlobalValue(configuration, "buildArguments");
        let execSwiftSpy: sinon.SinonSpy;
        const logger: MockedObject<SwiftLogger> = mockObject<SwiftLogger>({
            warn: sinon.spy(),
        });

        setup(async () => {
            execSwiftSpy = sinon.spy(() =>
                Promise.resolve({ stdout: "/test/bin/path\n", stderr: "" })
            );
            sinon.replace(utilities, "execSwift", execSwiftSpy);

            // Clear cache before each test
            BuildFlags.clearBuildPathCache();
            buildArgsConfig.setValue([]);
        });

        teardown(() => {
            sinon.restore();
            BuildFlags.clearBuildPathCache();
        });

        test("debug configuration calls swift build with correct arguments", async () => {
            const result = await buildFlags.getBuildBinaryPath(
                "/test/workspace",
                "${workspaceFolder:SimpleExecutable}",
                "debug",
                instance(logger)
            );

            expect(result).to.equal("/test/bin/path");
            expect(execSwiftSpy).to.have.been.calledOnce;

            const [args, , options] = execSwiftSpy.firstCall.args;
            expect(args).to.include("build");
            expect(args).to.include("--show-bin-path");
            expect(args).to.include("--configuration");
            expect(args).to.include("debug");
            expect(options.cwd).to.equal("/test/workspace");
        });

        test("release configuration calls swift build with correct arguments", async () => {
            const result = await buildFlags.getBuildBinaryPath(
                "/test/workspace",
                "${workspaceFolder:SimpleExecutable}",
                "release",
                instance(logger)
            );

            expect(result).to.equal("/test/bin/path");
            expect(execSwiftSpy).to.have.been.calledOnce;

            const [args] = execSwiftSpy.firstCall.args;
            expect(args).to.include("--configuration");
            expect(args).to.include("release");
        });

        test("includes build arguments in command", async () => {
            buildArgsConfig.setValue(["--build-system", "swiftbuild"]);

            await buildFlags.getBuildBinaryPath(
                "/test/workspace",
                "${workspaceFolder:SimpleExecutable}",
                "debug",
                instance(logger)
            );

            const [args] = execSwiftSpy.firstCall.args;
            expect(args).to.include("--build-system");
            expect(args).to.include("swiftbuild");
        });

        test("caches results based on workspace and configuration", async () => {
            // First call
            const result1 = await buildFlags.getBuildBinaryPath(
                "/test/workspace",
                "${workspaceFolder:SimpleExecutable}",
                "debug",
                instance(logger)
            );
            expect(result1).to.equal("/test/bin/path");
            expect(execSwiftSpy).to.have.been.calledOnce;

            // Second call should use cache
            const result2 = await buildFlags.getBuildBinaryPath(
                "/test/workspace",
                "${workspaceFolder:SimpleExecutable}",
                "debug",
                instance(logger)
            );
            expect(result2).to.equal("/test/bin/path");
            expect(execSwiftSpy).to.have.been.calledOnce; // Still only one call

            // Different configuration should not use cache
            const result3 = await buildFlags.getBuildBinaryPath(
                "/test/workspace",
                "/test/workspace",
                "release",
                instance(logger)
            );
            expect(result3).to.equal("/test/bin/path");
            expect(execSwiftSpy).to.have.been.calledTwice;
        });

        test("different build arguments create different cache entries", async () => {
            // First call with no build arguments
            await buildFlags.getBuildBinaryPath(
                "/test/workspace",
                "${workspaceFolder:SimpleExecutable}",
                "debug",
                instance(logger)
            );
            expect(execSwiftSpy).to.have.been.calledOnce;

            // Change build arguments
            buildArgsConfig.setValue(["--build-system", "swiftbuild"]);

            // Second call should not use cache due to different build arguments
            await buildFlags.getBuildBinaryPath(
                "/test/workspace",
                "${workspaceFolder:SimpleExecutable}",
                "debug",
                instance(logger)
            );
            expect(execSwiftSpy).to.have.been.calledTwice;
        });

        test("falls back to traditional path on error", async () => {
            // Restore the previous stub first
            sinon.restore();

            // Mock execSwift to throw an error
            execSwiftSpy = sinon.spy(() => Promise.reject(new Error("Command failed")));
            const utilities = await import("@src/utilities/utilities");
            sinon.replace(utilities, "execSwift", execSwiftSpy);

            const log = instance(logger);
            const result = await buildFlags.getBuildBinaryPath(
                "/test/workspace",
                "${workspaceFolder:SimpleExecutable}",
                "debug",
                log
            );

            // Should fallback to traditional path
            expect(result).to.include("${workspaceFolder:SimpleExecutable}");
            expect(result).to.include("debug");
            expect(log.warn).to.have.been.calledOnce;
        });

        test("clearBuildPathCache clears all cached entries", async () => {
            // Cache some entries
            await buildFlags.getBuildBinaryPath(
                "cwd",
                "${workspaceFolder:Workspace1}",
                "debug",
                instance(logger)
            );
            await buildFlags.getBuildBinaryPath(
                "cwd",
                "${workspaceFolder:Workspace2}",
                "release",
                instance(logger)
            );
            expect(execSwiftSpy).to.have.been.calledTwice;

            // Clear cache
            BuildFlags.clearBuildPathCache();

            // Next calls should execute again
            await buildFlags.getBuildBinaryPath(
                "cwd",
                "${workspaceFolder:Workspace1}",
                "debug",
                instance(logger)
            );
            expect(execSwiftSpy).to.have.been.calledThrice;
        });
    });
});
