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

import * as assert from "assert";
import { DarwinCompatibleTarget, SwiftToolchain } from "../../../src/toolchain/toolchain";
import { ArgumentFilter, BuildFlags } from "../../../src/toolchain/BuildFlags";
import { Version } from "../../../src/utilities/version";
import { instance, mock, when } from "ts-mockito";
import configuration from "../../../src/configuration";
import { mockValue } from "../MockUtils";

suite("BuildFlags Test Suite", () => {
    const platformConfig = mockValue(process, "platform");
    let toolchain: SwiftToolchain;
    let buildFlags: BuildFlags;

    suiteSetup(async () => {
        toolchain = mock(SwiftToolchain);
        when(toolchain.swiftVersion).thenReturn(new Version(6, 0, 0));
        buildFlags = new BuildFlags(instance(toolchain));
    });

    setup(() => {
        platformConfig.setValue("darwin");
    });

    suite("getDarwinTarget", () => {
        const sdkConfig = mockValue(configuration, "sdk");

        test("iPhoneOS", () => {
            sdkConfig.setValue("/some/other/full/test/path/iPhoneOS15.0.sdk");
            assert.deepEqual(buildFlags.getDarwinTarget()?.target, DarwinCompatibleTarget.iOS);
            assert.deepEqual(buildFlags.getDarwinTarget()?.version, "15.0");
        });

        test("AppleTVOS", () => {
            sdkConfig.setValue("/some/other/full/test/path/AppleTVOS4.1.2.sdk");
            assert.deepEqual(buildFlags.getDarwinTarget()?.target, DarwinCompatibleTarget.tvOS);
            assert.deepEqual(buildFlags.getDarwinTarget()?.version, "4.1.2");
        });

        test("WatchOS", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS7.0.sdk");
            assert.deepEqual(buildFlags.getDarwinTarget()?.target, DarwinCompatibleTarget.watchOS);
            assert.deepEqual(buildFlags.getDarwinTarget()?.version, "7.0");
        });

        test("XROS", () => {
            sdkConfig.setValue("/some/other/full/test/path/XROS2.0.sdk");
            assert.deepEqual(buildFlags.getDarwinTarget()?.target, DarwinCompatibleTarget.visionOS);
            assert.deepEqual(buildFlags.getDarwinTarget()?.version, "2.0");
        });

        test("invalid name", () => {
            sdkConfig.setValue("/some/other/full/test/path/UhOh1.2.3.sdk");
            assert.deepEqual(buildFlags.getDarwinTarget(), undefined);
        });
    });

    suite("swiftpmSDKFlags", () => {
        const sdkConfig = mockValue(configuration, "sdk");

        test("no configuration provided", async () => {
            sdkConfig.setValue("");
            assert.deepStrictEqual(buildFlags.swiftpmSDKFlags(), []);
        });

        test("configuration provided", () => {
            sdkConfig.setValue("/some/other/full/test/path");
            assert.deepStrictEqual(buildFlags.swiftpmSDKFlags(), [
                "--sdk",
                "/some/other/full/test/path",
            ]);
        });

        test("include target", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS.sdk");
            assert.deepStrictEqual(buildFlags.swiftpmSDKFlags(), [
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
        const sdkConfig = mockValue(configuration, "sdk");

        test("direct", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS.sdk");
            assert.deepStrictEqual(buildFlags.swiftDriverSDKFlags(), [
                "-sdk",
                "/some/other/full/test/path/WatchOS.sdk",
            ]);
        });

        test("indirect", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS.sdk");
            assert.deepStrictEqual(buildFlags.swiftDriverSDKFlags(true), [
                "-Xswiftc",
                "-sdk",
                "-Xswiftc",
                "/some/other/full/test/path/WatchOS.sdk",
            ]);
        });
    });

    suite("swiftDriverTargetFlags", () => {
        const sdkConfig = mockValue(configuration, "sdk");

        test("direct", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS.sdk");
            assert.deepStrictEqual(buildFlags.swiftDriverTargetFlags(), [
                "-target",
                "arm64-apple-watchos",
            ]);
        });

        test("indirect", () => {
            sdkConfig.setValue("/some/other/full/test/path/WatchOS.sdk");
            assert.deepStrictEqual(buildFlags.swiftDriverTargetFlags(true), [
                "-Xswiftc",
                "-target",
                "-Xswiftc",
                "arm64-apple-watchos",
            ]);
        });
    });

    suite("buildPathFlags", () => {
        const buildPathConfig = mockValue(configuration, "buildPath");

        test("no configuration provided", async () => {
            buildPathConfig.setValue("");
            assert.deepStrictEqual(buildFlags.buildPathFlags(), []);
        });

        test("configuration provided", () => {
            buildPathConfig.setValue("/some/other/full/test/path");
            assert.deepStrictEqual(buildFlags.buildPathFlags(), [
                "--scratch-path",
                "/some/other/full/test/path",
            ]);
        });

        test("configuration provided, before swift 5.8", () => {
            when(toolchain.swiftVersion).thenReturn(new Version(5, 7, 0));
            buildPathConfig.setValue("/some/other/full/test/path");
            assert.deepStrictEqual(buildFlags.buildPathFlags(), [
                "--build-path",
                "/some/other/full/test/path",
            ]);
        });
    });

    suite("buildDirectoryFromWorkspacePath", async () => {
        const buildPathConfig = mockValue(configuration, "buildPath");

        test("no configuration provided", () => {
            buildPathConfig.setValue("");

            assert.strictEqual(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false),
                ".build"
            );

            assert.strictEqual(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true),
                "/some/full/workspace/test/path/.build"
            );
        });

        test("absolute configuration provided", () => {
            buildPathConfig.setValue("/some/other/full/test/path");

            assert.strictEqual(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false),
                "/some/other/full/test/path"
            );

            assert.strictEqual(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true),
                "/some/other/full/test/path"
            );
        });

        test("relative configuration provided", () => {
            buildPathConfig.setValue("some/relative/test/path");

            assert.strictEqual(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", false),
                "some/relative/test/path"
            );

            assert.strictEqual(
                BuildFlags.buildDirectoryFromWorkspacePath("/some/full/workspace/test/path", true),
                "/some/full/workspace/test/path/some/relative/test/path"
            );
        });
    });

    suite("withSwiftSDKFlags", () => {
        const sdkConfig = mockValue(configuration, "sdk");

        test("package", () => {
            for (const sub of ["dump-symbol-graph", "diagnose-api-breaking-changes", "resolve"]) {
                sdkConfig.setValue("");
                assert.deepStrictEqual(
                    buildFlags.withSwiftSDKFlags(["package", sub, "--disable-sandbox"]),
                    ["package", sub, "--disable-sandbox"]
                );

                sdkConfig.setValue("/some/full/path/to/sdk");
                assert.deepStrictEqual(
                    buildFlags.withSwiftSDKFlags(["package", sub, "--disable-sandbox"]),
                    ["package", sub, "--sdk", "/some/full/path/to/sdk", "--disable-sandbox"]
                );
            }

            sdkConfig.setValue("");
            assert.deepStrictEqual(
                buildFlags.withSwiftSDKFlags(["package", "init", "--disable-sandbox"]),
                ["package", "init", "--disable-sandbox"]
            );

            sdkConfig.setValue("/some/full/path/to/sdk");
            assert.deepStrictEqual(
                buildFlags.withSwiftSDKFlags(["package", "init", "--disable-sandbox"]),
                ["package", "init", "--disable-sandbox"]
            );
        });

        test("build", () => {
            sdkConfig.setValue("");
            assert.deepStrictEqual(
                buildFlags.withSwiftSDKFlags(["build", "--target", "MyExecutable"]),
                ["build", "--target", "MyExecutable"]
            );

            sdkConfig.setValue("/some/full/path/to/sdk");
            assert.deepStrictEqual(
                buildFlags.withSwiftSDKFlags(["build", "--target", "MyExecutable"]),
                ["build", "--sdk", "/some/full/path/to/sdk", "--target", "MyExecutable"]
            );
        });

        test("run", () => {
            sdkConfig.setValue("");
            assert.deepStrictEqual(
                buildFlags.withSwiftSDKFlags(["run", "--product", "MyExecutable"]),
                ["run", "--product", "MyExecutable"]
            );

            sdkConfig.setValue("/some/full/path/to/sdk");
            assert.deepStrictEqual(
                buildFlags.withSwiftSDKFlags(["run", "--product", "MyExecutable"]),
                ["run", "--sdk", "/some/full/path/to/sdk", "--product", "MyExecutable"]
            );
        });

        test("test", () => {
            sdkConfig.setValue("");
            assert.deepStrictEqual(buildFlags.withSwiftSDKFlags(["test", "--filter", "MyTests"]), [
                "test",
                "--filter",
                "MyTests",
            ]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            assert.deepStrictEqual(buildFlags.withSwiftSDKFlags(["test", "--filter", "MyTests"]), [
                "test",
                "--sdk",
                "/some/full/path/to/sdk",
                "--filter",
                "MyTests",
            ]);
        });

        test("other commands", () => {
            sdkConfig.setValue("");
            assert.deepStrictEqual(buildFlags.withSwiftSDKFlags(["help", "repl"]), [
                "help",
                "repl",
            ]);

            sdkConfig.setValue("/some/full/path/to/sdk");
            assert.deepStrictEqual(buildFlags.withSwiftSDKFlags(["help", "repl"]), [
                "help",
                "repl",
            ]);
        });
    });

    test("filterArguments", () => {
        const argumentFilter: ArgumentFilter[] = [
            { argument: "-one", include: 1 },
            { argument: "-1", include: 1 },
            { argument: "-zero", include: 0 },
            { argument: "-two", include: 2 },
        ];
        assert.notStrictEqual(BuildFlags.filterArguments(["-test", "this"], argumentFilter), []);
        assert.notStrictEqual(BuildFlags.filterArguments(["-test", "-zero"], argumentFilter), [
            "-zero",
        ]);
        assert.notStrictEqual(
            BuildFlags.filterArguments(["-one", "inc1", "test"], argumentFilter),
            ["-one", "inc1"]
        );
        assert.notStrictEqual(
            BuildFlags.filterArguments(["-two", "inc1", "inc2"], argumentFilter),
            ["-one", "inc1", "inc2"]
        );
        assert.notStrictEqual(
            BuildFlags.filterArguments(["-ignore", "-one", "inc1", "test"], argumentFilter),
            ["-one", "inc1"]
        );
        assert.notStrictEqual(
            BuildFlags.filterArguments(["-one", "inc1", "test", "-1", "inc2"], argumentFilter),
            ["-one", "inc1", "-1", "inc2"]
        );
        assert.notStrictEqual(
            BuildFlags.filterArguments(["-one=1", "-zero=0", "-one1=1"], argumentFilter),
            ["-one=1"]
        );
    });
});
