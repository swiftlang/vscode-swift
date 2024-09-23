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

const isCIBuild = process.env["CI"] === "1";
const isFastTestRun = process.env["FAST_TEST_RUN"] === "1";

// "env" in launch.json doesn't seem to work with vscode-test
const isDebugRun = !(process.env["_"] ?? "").endsWith("node_modules/.bin/vscode-test");

// so tests don't timeout when a breakpoint is hit
const timeout = isDebugRun ? Number.MAX_SAFE_INTEGER : 3000

module.exports = defineConfig({
    tests: [
        {
            label: "integrationTests",
            files: ["out/test/common.js", "out/test/suite/**/*.test.js"],
            version: "stable",
            workspaceFolder: "./assets/test",
            mocha: {
                ui: "tdd",
                color: true,
                timeout,
                forbidOnly: isCIBuild,
                grep: isFastTestRun ? "@slow" : undefined,
                invert: isFastTestRun,
                slow: 10000
            },
            installExtensions: ["vadimcn.vscode-lldb"],
            reuseMachineInstall: !isCIBuild,
        },
        {
            label: "unitTests",
            files: ["out/test/common.js", "out/test/unit-tests/**/*.test.js"],
            version: "stable",
            mocha: {
                ui: "tdd",
                color: true,
                timeout,
                forbidOnly: isCIBuild,
                slow: 100
            },
            reuseMachineInstall: !isCIBuild,
        },
        // you can specify additional test configurations, too
    ],
    coverage: {
        includeAll: true,
        exclude: ["**/test/suite/**", "**/test/unit-tests/**"],
        reporter: ["text", "lcov"], // "lcov" also generates HTML
    },
});