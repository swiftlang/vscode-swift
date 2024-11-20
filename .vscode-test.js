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

const { defineConfig } = require("@vscode/test-cli");
const path = require("path");

const isCIBuild = false; // process.env["CI"] === "1";
const isFastTestRun = process.env["FAST_TEST_RUN"] === "1";

// "env" in launch.json doesn't seem to work with vscode-test
const isDebugRun = !(process.env["_"] ?? "").endsWith("node_modules/.bin/vscode-test");

// so tests don't timeout when a breakpoint is hit
const timeout = isDebugRun ? Number.MAX_SAFE_INTEGER : 3000;

module.exports = defineConfig({
    tests: [
        {
            label: "integrationTests",
            files: ["dist/test/common.js", "dist/test/integration-tests/**/*.test.js"],
            version: process.env["VSCODE_VERSION"] ?? "stable",
            workspaceFolder: "./assets/test",
            launchArgs: [
                "--disable-updates",
                "--disable-crash-reporter",
                "--disable-workspace-trust",
                "--disable-telemetry",
            ],
            mocha: {
                ui: "tdd",
                color: true,
                timeout,
                forbidOnly: isCIBuild,
                grep: isFastTestRun ? "@slow" : undefined,
                invert: isFastTestRun,
                slow: 10000,
                reporter: path.join(__dirname, ".mocha-reporter.js"),
                reporterOptions: {
                    jsonReporterOptions: {
                        output: path.join(__dirname, "test-results", "integration-tests.json"),
                    },
                },
            },
            reuseMachineInstall: !isCIBuild,
            installExtensions: ["vadimcn.vscode-lldb"],
        },
        {
            label: "unitTests",
            files: ["dist/test/common.js", "dist/test/unit-tests/**/*.test.js"],
            version: process.env["VSCODE_VERSION"] ?? "stable",
            launchArgs: [
                "--disable-extensions",
                "--disable-updates",
                "--disable-crash-reporter",
                "--disable-workspace-trust",
                "--disable-telemetry",
            ],
            mocha: {
                ui: "tdd",
                color: true,
                timeout,
                forbidOnly: isCIBuild,
                slow: 100,
                reporter: path.join(__dirname, ".mocha-reporter.js"),
                reporterOptions: {
                    jsonReporterOptions: {
                        output: path.join(__dirname, "test-results", "unit-tests.json"),
                    },
                },
            },
            reuseMachineInstall: !isCIBuild,
        },
        // you can specify additional test configurations, too
    ],
    coverage: {
        includeAll: true,
        exclude: ["**/test/**"],
        reporter: ["text", "lcov"], // "lcov" also generates HTML
    },
});
