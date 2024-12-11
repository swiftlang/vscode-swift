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
import { DarwinCompatibleTarget, SwiftToolchain } from "../../../src/toolchain/toolchain";
import { ArgumentFilter, BuildFlags } from "../../../src/toolchain/BuildFlags";
import { Version } from "../../../src/utilities/version";
import configuration from "../../../src/configuration";
import { mockObject, mockGlobalValue, MockedObject, instance } from "../../MockUtils";

suite("BuildFlags Test Suite", () => {
    const mockedPlatform = mockGlobalValue(process, "platform");
    let mockedToolchain: MockedObject<SwiftToolchain>;
    let buildFlags: BuildFlags;

    suiteSetup(async () => {
        mockedToolchain = mockObject<SwiftToolchain>({
            swiftVersion: new Version(6, 0, 0),
        });
        buildFlags = new BuildFlags(instance(mockedToolchain));
    });

    setup(() => {
        mockedPlatform.setValue("darwin");
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

        test("no configuration provided", async () => {
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

        test("no configuration provided", async () => {
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

    suite("buildDirectoryFromWorkspacePath", async () => {
        const buildPathConfig = mockGlobalValue(configuration, "buildPath");

        test("no configuration provided", () => {
            buildPathConfig.setValue("");

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false)
            ).to.equal(".build");

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true)
            ).to.equal("/some/full/workspace/test/path/.build");
        });

        test("absolute configuration provided", () => {
            buildPathConfig.setValue("/some/other/full/test/path");

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false)
            ).to.equal("/some/other/full/test/path");

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true)
            ).to.equal("/some/other/full/test/path");
        });

        test("relative configuration provided", () => {
            buildPathConfig.setValue("some/relative/test/path");

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false)
            ).to.equal("some/relative/test/path");

            expect(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true)
            ).to.equal("/some/full/workspace/test/path/some/relative/test/path");
        });
    });

    suite("withSwiftSDKFlags", () => {
        const sdkConfig = mockGlobalValue(configuration, "sdk");

        test("package", () => {
            for (const sub of ["dump-symbol-graph", "diagnose-api-breaking-changes", "resolve"]) {
                sdkConfig.setValue("");
                expect(
                    buildFlags.withSwiftSDKFlags(["package", sub, "--disable-sandbox"])
                ).to.deep.equal(["package", sub, "--disable-sandbox"]);

                sdkConfig.setValue("/some/full/path/to/sdk");
                expect(
                    buildFlags.withSwiftSDKFlags(["package", sub, "--disable-sandbox"])
                ).to.deep.equal([
                    "package",
                    sub,
                    "--sdk",
                    "/some/full/path/to/sdk",
                    "--disable-sandbox",
                ]);
            }

            sdkConfig.setValue("");
            expect(
                buildFlags.withSwiftSDKFlags(["package", "init", "--disable-sandbox"])
            ).to.deep.equal(["package", "init", "--disable-sandbox"]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            expect(
                buildFlags.withSwiftSDKFlags(["package", "init", "--disable-sandbox"])
            ).to.deep.equal(["package", "init", "--disable-sandbox"]);
        });

        test("build", () => {
            sdkConfig.setValue("");
            expect(
                buildFlags.withSwiftSDKFlags(["build", "--target", "MyExecutable"])
            ).to.deep.equal(["build", "--target", "MyExecutable"]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            expect(
                buildFlags.withSwiftSDKFlags(["build", "--target", "MyExecutable"])
            ).to.deep.equal([
                "build",
                "--sdk",
                "/some/full/path/to/sdk",
                "--target",
                "MyExecutable",
            ]);
        });

        test("run", () => {
            sdkConfig.setValue("");
            expect(
                buildFlags.withSwiftSDKFlags(["run", "--product", "MyExecutable"])
            ).to.deep.equal(["run", "--product", "MyExecutable"]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            expect(
                buildFlags.withSwiftSDKFlags(["run", "--product", "MyExecutable"])
            ).to.deep.equal([
                "run",
                "--sdk",
                "/some/full/path/to/sdk",
                "--product",
                "MyExecutable",
            ]);
        });

        test("test", () => {
            sdkConfig.setValue("");
            expect(buildFlags.withSwiftSDKFlags(["test", "--filter", "MyTests"])).to.deep.equal([
                "test",
                "--filter",
                "MyTests",
            ]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            expect(buildFlags.withSwiftSDKFlags(["test", "--filter", "MyTests"])).to.deep.equal([
                "test",
                "--sdk",
                "/some/full/path/to/sdk",
                "--filter",
                "MyTests",
            ]);
        });

        test("other commands", () => {
            sdkConfig.setValue("");
            expect(buildFlags.withSwiftSDKFlags(["help", "repl"])).to.deep.equal(["help", "repl"]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            expect(buildFlags.withSwiftSDKFlags(["help", "repl"])).to.deep.equal(["help", "repl"]);
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
});
