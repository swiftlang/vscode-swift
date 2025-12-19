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
import { setup } from "mocha";
import { match } from "sinon";
import * as vscode from "vscode";

import configuration from "@src/configuration";

import { instance, mockFn, mockGlobalObject, mockObject } from "../../MockUtils";

suite("Configuration/Settings Test Suite", () => {
    suite("Type validation", () => {
        const mockWorkspace = mockGlobalObject(vscode, "workspace");

        setup(() => {
            mockWorkspace.getConfiguration.reset();
        });

        function mockSetting<T>(settingName: string, value: T) {
            const [, ...rest] = settingName.split(".");
            const mockSwiftConfig = mockObject<vscode.WorkspaceConfiguration>({
                get: mockFn(s => s.withArgs(rest.join("."), match.any).returns(value)),
            });
            mockWorkspace.getConfiguration.returns(instance(mockSwiftConfig));
        }

        test("returns a string configuration value", () => {
            mockSetting("swift.path", "foo");
            assert.equal(configuration.path, "foo");
        });

        test("throws when a string setting is not a string", () => {
            mockSetting("swift.path", 42);
            assert.throws(() => {
                configuration.path;
            });
        });

        test("returns a boolean configuration value", () => {
            mockSetting("swift.recordTestDuration", false);
            assert.equal(configuration.recordTestDuration, false);
        });

        test("throws when a boolean setting is not a boolean", () => {
            mockSetting("swift.recordTestDuration", "notaboolean");
            assert.throws(() => {
                configuration.recordTestDuration;
            });
        });

        test("returns a string array configuration value", () => {
            mockSetting("swift.excludeFromCodeCoverage", ["foo", "bar"]);
            assert.deepEqual(configuration.excludeFromCodeCoverage, ["foo", "bar"]);
        });

        test("throws when a string array setting is not a string array", () => {
            mockSetting("swift.excludeFromCodeCoverage", [42, true]);
            assert.throws(() => {
                configuration.excludeFromCodeCoverage;
            });
        });

        test("returns an object configuration value", () => {
            const obj = { FOO: "BAR" };
            mockSetting("swift.swiftEnvironmentVariables", obj);
            assert.deepEqual(configuration.swiftEnvironmentVariables, obj);
        });

        test("throws when an object setting is not an object", () => {
            mockSetting("swift.swiftEnvironmentVariables", "notanobject");
            assert.throws(() => {
                configuration.swiftEnvironmentVariables;
            });
        });
    });
});
