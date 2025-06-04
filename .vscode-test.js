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
const { version, publisher, name } = require("./package.json");

const isCIBuild = process.env["CI"] === "1";
const isFastTestRun = process.env["FAST_TEST_RUN"] === "1";

const dataDir = process.env["VSCODE_DATA_DIR"];

// "env" in launch.json doesn't seem to work with vscode-test
const isDebugRun = !(process.env["_"] ?? "").endsWith("node_modules/.bin/vscode-test");

// so tests don't timeout when a breakpoint is hit
const timeout = isDebugRun ? Number.MAX_SAFE_INTEGER : 3000;

const launchArgs = [
    "--disable-updates",
    "--disable-crash-reporter",
    "--disable-workspace-trust",
    "--disable-telemetry",
];
if (dataDir) {
    launchArgs.push("--user-data-dir", dataDir);
}
// GPU hardware acceleration not working on Darwin for intel
if (process.platform === "darwin" && process.arch === "x64") {
    launchArgs.push("--disable-gpu");
}
let vsixPath = process.env["VSCODE_SWIFT_VSIX"];
const install = [];
const installExtensions = ["vadimcn.vscode-lldb", "llvm-vs-code-extensions.lldb-dap"];
if (vsixPath) {
    if (!path.isAbsolute(vsixPath)) {
        vsixPath = path.join(__dirname, vsixPath);
    }
    console.log("Installing " + vsixPath);
    install.push({
        label: "installExtension",
        installExtensions: installExtensions.concat(vsixPath ? [vsixPath] : []),
        launchArgs,
        files: [],
        version: process.env["VSCODE_VERSION"] ?? "stable",
        reuseMachineInstall: !isCIBuild,
    });
}

module.exports = defineConfig({
    tests: [
        ...install,
        {
            label: "integrationTests",
            files: ["dist/test/common.js", "dist/test/integration-tests/**/*.test.js"],
            version: process.env["VSCODE_VERSION"] ?? "stable",
            workspaceFolder: "./assets/test",
            launchArgs,
            extensionDevelopmentPath: vsixPath
                ? [`${__dirname}/.vscode-test/extensions/${publisher}.${name}-${version}`]
                : undefined,
            mocha: {
                ui: "tdd",
                color: true,
                timeout,
                forbidOnly: isCIBuild,
                grep: isFastTestRun ? "@slow" : undefined,
                invert: isFastTestRun,
                slow: 10000,
                retries: 1,
                reporter: path.join(__dirname, ".mocha-reporter.js"),
                reporterOptions: {
                    jsonReporterOptions: {
                        output: path.join(__dirname, "test-results", "integration-tests.json"),
                    },
                },
            },
            reuseMachineInstall: !isCIBuild,
            installExtensions,
        },
        {
            label: "unitTests",
            files: ["dist/test/common.js", "dist/test/unit-tests/**/*.test.js"],
            version: process.env["VSCODE_VERSION"] ?? "stable",
            launchArgs: launchArgs.concat("--disable-extensions"),
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
            skipExtensionDependencies: true,
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
