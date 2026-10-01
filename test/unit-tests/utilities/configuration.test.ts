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
import { expect } from "chai";
import { setup } from "mocha";
import { match } from "sinon";
import * as vscode from "vscode";

import configuration, { resetReportedSettingWarnings } from "@src/configuration";

import { instance, mockFn, mockGlobalObject, mockObject } from "../../MockUtils";

suite("Configuration/Settings Test Suite", () => {
    suite("Type validation", () => {
        const mockWorkspace = mockGlobalObject(vscode, "workspace");
        const mockWindow = mockGlobalObject(vscode, "window");

        setup(() => {
            mockWorkspace.getConfiguration.reset();
            // Fail loudly if a getter reads a configuration section that wasn't mocked
            mockWorkspace.getConfiguration.callsFake((section?: string) => {
                throw new Error(`Unexpected read of configuration section "${section}"`);
            });
            mockWindow.showWarningMessage.resolves(undefined);
            resetReportedSettingWarnings();
        });

        function assertSettingWarningShown(settingName: string) {
            expect(
                mockWindow.showWarningMessage,
                `Expected a warning to be shown for ${settingName}`
            ).to.have.been.calledWith(match(`\`${settingName}\``));
        }

        function mockSetting<T>(settingName: string, value: T) {
            // A setting can be read with any split between section and key. e.g.
            // getConfiguration("swift").get("a.b") or getConfiguration("swift.a").get("b")
            const parts = settingName.split(".");
            for (let i = 1; i < parts.length; i++) {
                const key = parts.slice(i).join(".");
                const mockConfig = mockObject<vscode.WorkspaceConfiguration>({
                    get: mockFn(s => {
                        // Fail loudly if a getter reads a setting that wasn't mocked
                        s.callsFake((k: string) => {
                            throw new Error(`Unexpected read of setting "${k}"`);
                        });
                        s.withArgs(key).returns(value);
                    }),
                    inspect: mockFn(),
                });
                mockWorkspace.getConfiguration
                    .withArgs(parts.slice(0, i).join("."))
                    .returns(instance(mockConfig));
            }
        }

        test("returns a string configuration value", () => {
            mockSetting("swift.path", "foo");
            expect(configuration.path).to.equal("foo");
        });

        test("uses the default when a setting is not configured", () => {
            mockSetting("swift.recordTestDuration", undefined);
            expect(configuration.recordTestDuration).to.equal(true);
            expect(mockWindow.showWarningMessage).to.not.have.been.called;
        });

        test("uses the default when a string setting is not a string", () => {
            mockSetting("swift.path", 42);
            expect(configuration.path).to.equal("");
            assertSettingWarningShown("swift.path");
        });

        test("returns a boolean configuration value", () => {
            mockSetting("swift.recordTestDuration", false);
            expect(configuration.recordTestDuration).to.equal(false);
        });

        test("uses the default when a boolean setting is not a boolean", () => {
            mockSetting("swift.recordTestDuration", "notaboolean");
            expect(configuration.recordTestDuration).to.equal(true);
            assertSettingWarningShown("swift.recordTestDuration");
        });

        test("returns a string array configuration value", () => {
            mockSetting("swift.excludeFromCodeCoverage", ["foo", "bar"]);
            expect(configuration.excludeFromCodeCoverage).to.deep.equal(["foo", "bar"]);
        });

        test("uses the default when a string array setting is not a string array", () => {
            mockSetting("swift.excludeFromCodeCoverage", [42, true]);
            expect(configuration.excludeFromCodeCoverage).to.deep.equal([]);
            assertSettingWarningShown("swift.excludeFromCodeCoverage");
        });

        test("uses the default when a string array setting is not an array", () => {
            mockSetting("swift.buildArguments", "notanarray");
            expect(configuration.buildArguments).to.deep.equal([]);
            assertSettingWarningShown("swift.buildArguments");
        });

        test("only shows a warning once for the same bad array value", () => {
            mockSetting("swift.excludeFromCodeCoverage", [42]);
            configuration.excludeFromCodeCoverage;
            mockSetting("swift.excludeFromCodeCoverage", [42]);
            configuration.excludeFromCodeCoverage;
            expect(mockWindow.showWarningMessage.callCount).to.equal(1);
        });

        test("only shows a warning once for each bad value when alternating between them", () => {
            // e.g. two workspace folders with different bad values for the same setting
            for (const value of ["a", 42, "a", 42]) {
                mockSetting("swift.additionalTestArguments", value);
                configuration.folder(undefined).additionalTestArguments;
            }
            expect(mockWindow.showWarningMessage.callCount).to.equal(2);
        });

        test("returns an object configuration value", () => {
            const obj = { FOO: "BAR" };
            mockSetting("swift.swiftEnvironmentVariables", obj);
            expect(configuration.swiftEnvironmentVariables).to.deep.equal(obj);
        });

        test("uses the default when an object setting is not an object", () => {
            mockSetting("swift.swiftEnvironmentVariables", "notanobject");
            expect(configuration.swiftEnvironmentVariables).to.deep.equal({});
            assertSettingWarningShown("swift.swiftEnvironmentVariables");
        });

        test("uses the default when an object setting is null", () => {
            mockSetting("swift.swiftEnvironmentVariables", null);
            expect(configuration.swiftEnvironmentVariables).to.deep.equal({});
            assertSettingWarningShown("swift.swiftEnvironmentVariables");
        });

        test("uses the default when an object setting is an array", () => {
            mockSetting("swift.swiftEnvironmentVariables", ["FOO=BAR"]);
            expect(configuration.swiftEnvironmentVariables).to.deep.equal({});
            assertSettingWarningShown("swift.swiftEnvironmentVariables");
        });

        test("removes environment variables whose values are not strings", () => {
            mockSetting("swift.testEnvironmentVariables", { FOO: "BAR", BAZ: 1, QUX: null });
            expect(configuration.folder(undefined).testEnvironmentVariables).to.deep.equal({
                FOO: "BAR",
            });
            assertSettingWarningShown("swift.testEnvironmentVariables");
            expect(mockWindow.showWarningMessage).to.have.been.calledWith(match("`BAZ`, `QUX`"));
        });

        suite("backgroundCompilation", () => {
            test("returns a boolean configuration value", () => {
                mockSetting("swift.backgroundCompilation", true);
                const config = configuration.backgroundCompilation;
                expect(config.enabled).to.equal(true);
                expect(config.useDefaultTask).to.equal(true);
                expect(config.release).to.equal(false);
            });

            test("returns an object configuration value", () => {
                mockSetting("swift.backgroundCompilation", {
                    enabled: true,
                    useDefaultTask: false,
                    release: true,
                });
                const config = configuration.backgroundCompilation;
                expect(config.enabled).to.equal(true);
                expect(config.useDefaultTask).to.equal(false);
                expect(config.release).to.equal(true);
                expect(mockWindow.showWarningMessage).to.not.have.been.called;
            });

            test("uses the default when the setting is null", () => {
                mockSetting("swift.backgroundCompilation", null);
                expect(configuration.backgroundCompilation.enabled).to.equal(false);
                assertSettingWarningShown("swift.backgroundCompilation");
            });

            test("uses the default when an object property is not a boolean", () => {
                mockSetting("swift.backgroundCompilation", { enabled: "yes" });
                expect(configuration.backgroundCompilation.enabled).to.equal(false);
                assertSettingWarningShown("swift.backgroundCompilation");
            });
        });

        suite("plugin settings", () => {
            test("returns global plugin arguments", () => {
                mockSetting("swift.pluginArguments", ["-c", "release"]);
                const config = configuration.folder(undefined);
                expect(config.pluginArguments()).to.deep.equal(["-c", "release"]);
                expect(config.pluginArguments("foo")).to.deep.equal([]);
            });

            test("returns plugin arguments keyed by plugin id", () => {
                mockSetting("swift.pluginArguments", { "*": ["-v"], foo: ["-c", "release"] });
                const config = configuration.folder(undefined);
                expect(config.pluginArguments()).to.deep.equal(["-v"]);
                expect(config.pluginArguments("foo")).to.deep.equal(["-c", "release"]);
                expect(config.pluginArguments("bar")).to.deep.equal([]);
                expect(mockWindow.showWarningMessage).to.not.have.been.called;
            });

            test("returns global plugin permissions", () => {
                mockSetting("swift.pluginPermissions", { disableSandbox: true });
                const config = configuration.folder(undefined);
                expect(config.pluginPermissions()).to.deep.equal({ disableSandbox: true });
                expect(mockWindow.showWarningMessage).to.not.have.been.called;
            });

            test("returns plugin permissions keyed by plugin id", () => {
                mockSetting("swift.pluginPermissions", { foo: { disableSandbox: true } });
                const config = configuration.folder(undefined);
                expect(config.pluginPermissions("foo")).to.deep.equal({ disableSandbox: true });
                expect(config.pluginPermissions("bar")).to.deep.equal({});
                expect(mockWindow.showWarningMessage).to.not.have.been.called;
            });

            test("uses the default when plugin arguments are null", () => {
                mockSetting("swift.pluginArguments", null);
                const config = configuration.folder(undefined);
                expect(config.pluginArguments()).to.deep.equal([]);
                expect(config.pluginArguments("foo")).to.deep.equal([]);
                assertSettingWarningShown("swift.pluginArguments");
            });

            test("uses the default when plugin arguments are not strings", () => {
                mockSetting("swift.pluginArguments", [42]);
                expect(configuration.folder(undefined).pluginArguments()).to.deep.equal([]);
                assertSettingWarningShown("swift.pluginArguments");
            });

            test("uses the default when a plugin's arguments are not an array", () => {
                mockSetting("swift.pluginArguments", { foo: "-c release" });
                expect(configuration.folder(undefined).pluginArguments("foo")).to.deep.equal([]);
                assertSettingWarningShown("swift.pluginArguments");
            });

            test("uses the default when plugin permissions are null", () => {
                mockSetting("swift.pluginPermissions", null);
                const config = configuration.folder(undefined);
                expect(config.pluginPermissions()).to.deep.equal({});
                expect(config.pluginPermissions("foo")).to.deep.equal({});
                assertSettingWarningShown("swift.pluginPermissions");
            });

            test("uses the default when a plugin's permissions are not an object", () => {
                mockSetting("swift.pluginPermissions", { foo: true });
                expect(configuration.folder(undefined).pluginPermissions("foo")).to.deep.equal({});
                assertSettingWarningShown("swift.pluginPermissions");
            });
        });

        test("returns an integer configuration value", () => {
            mockSetting("swift.maxSwiftVersionFileWatchDepth", 12);
            expect(configuration.folder(undefined).maxSwiftVersionFileWatchDepth).to.equal(12);
        });

        test("uses the default when an integer setting is not a number", () => {
            mockSetting("swift.maxSwiftVersionFileWatchDepth", "notanumber");
            expect(configuration.folder(undefined).maxSwiftVersionFileWatchDepth).to.equal(64);
            assertSettingWarningShown("swift.maxSwiftVersionFileWatchDepth");
        });

        test("uses the default when an integer setting is NaN", () => {
            mockSetting("swift.maxSwiftVersionFileWatchDepth", NaN);
            expect(configuration.folder(undefined).maxSwiftVersionFileWatchDepth).to.equal(64);
            assertSettingWarningShown("swift.maxSwiftVersionFileWatchDepth");
        });

        test("floors an integer setting that is not a whole number", () => {
            mockSetting("swift.maxSwiftVersionFileWatchDepth", 2.5);
            expect(configuration.folder(undefined).maxSwiftVersionFileWatchDepth).to.equal(2);
        });

        test("clamps an integer setting that is below its minimum", () => {
            mockSetting("swift.maxSwiftVersionFileWatchDepth", 0);
            expect(configuration.folder(undefined).maxSwiftVersionFileWatchDepth).to.equal(1);
        });
    });
});
