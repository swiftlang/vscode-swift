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
// @ts-check

const { defineConfig } = require("@vscode/test-cli");
const path = require("path");

const isCIBuild = process.env["CI"] === "1";

const dataDir = process.env["VSCODE_DATA_DIR"];

// Check if we're debugging by looking at the process executable. Unfortunately, the VS Code debugger
// doesn't seem to allow setting environment variables on a launched extension host.
//
// When debugging, the process will be launched under VS Code instead of NodeJS.
const isDebugRun = !isCIBuild && process.argv0.toLocaleLowerCase().includes("code");

function log(/** @type {string} */ message) {
    if (!isDebugRun) {
        console.log(message);
    }
}

// Remove the default timeout when debugging to avoid test failures when a breakpoint is hit.
// Keep this up to date with the timeout of a 'small' test in 'test/tags.ts'.
const timeout = isDebugRun ? 0 : 2000;

const launchArgs = [
    "--disable-updates",
    "--disable-crash-reporter",
    "--disable-workspace-trust",
    "--disable-telemetry",
    "--disable-gpu",
    "--disable-gpu-sandbox",
    "--disable-chromium-sandbox",
    "--disable-extension=vscode.git",
];
if (dataDir) {
    launchArgs.push("--user-data-dir", dataDir);
}

const installExtensions = ["vadimcn.vscode-lldb", "llvm-vs-code-extensions.lldb-dap"];
if (process.env["VSCODE_SWIFT_VSIX"]) {
    const vsixPath = path.resolve(__dirname, process.env["VSCODE_SWIFT_VSIX"]);
    log("Running tests against VSIX: " + vsixPath);
    installExtensions.push(vsixPath);
}

const vscodeVersion = process.env["VSCODE_VERSION"] ?? "1.105.1";
log("Running tests against VS Code version " + vscodeVersion);

const env = {
    ...process.env,
    RUNNING_UNDER_VSCODE_TEST_CLI: "1",
    VSCODE_DEBUG: isDebugRun ? "1" : "0",
};
log("Running tests against environment:\n" + JSON.stringify(env, undefined, 2));

module.exports = defineConfig({
    tests: [
        {
            label: "integrationTests",
            files: ["dist/test/common.js", "dist/test/integration-tests/**/*.test.js"],
            version: vscodeVersion,
            workspaceFolder: "./assets/test",
            launchArgs,
            env,
            mocha: {
                ui: "tdd",
                color: true,
                timeout,
                slow: 10000,
                retries: 1,
                reporter: path.join(__dirname, ".mocha-reporter.js"),
                reporterOptions: {
                    githubActionsSummaryReporterOptions: {
                        title: "Integration Test Summary",
                    },
                    jsonReporterOptions: {
                        output: path.join(__dirname, "test-results", "integration-tests.json"),
                    },
                },
            },
            installExtensions,
        },
        {
            label: "codeWorkspaceTests",
            files: [
                "dist/test/common.js",
                "dist/test/integration-tests/extension.test.js",
                "dist/test/integration-tests/WorkspaceContext.test.js",
                "dist/test/integration-tests/tasks/**/*.test.js",
                "dist/test/integration-tests/commands/build.test.js",
                "dist/test/integration-tests/testexplorer/TestExplorerIntegration.test.js",
                "dist/test/integration-tests/commands/dependency.test.js",
            ],
            version: vscodeVersion,
            workspaceFolder: "./assets/test.code-workspace",
            launchArgs,
            env,
            mocha: {
                ui: "tdd",
                color: true,
                timeout,
                slow: 10000,
                retries: 1,
                reporter: path.join(__dirname, ".mocha-reporter.js"),
                reporterOptions: {
                    githubActionsSummaryReporterOptions: {
                        title: "Code Workspace Test Summary",
                    },
                    jsonReporterOptions: {
                        output: path.join(__dirname, "test-results", "code-workspace-tests.json"),
                    },
                },
            },
            installExtensions,
        },
        {
            label: "unitTests",
            files: ["dist/test/common.js", "dist/test/unit-tests/**/*.test.js"],
            version: vscodeVersion,
            launchArgs: launchArgs.concat("--disable-extensions"),
            env,
            mocha: {
                ui: "tdd",
                color: true,
                timeout,
                slow: 100,
                reporter: path.join(__dirname, ".mocha-reporter.js"),
                reporterOptions: {
                    githubActionsSummaryReporterOptions: {
                        title: "Unit Test Summary",
                    },
                    jsonReporterOptions: {
                        output: path.join(__dirname, "test-results", "unit-tests.json"),
                    },
                },
            },
            skipExtensionDependencies: true,
        },
        // you can specify additional test configurations, too
    ],
    coverage: {
        includeAll: true,
        exclude: ["**/test/**"],
        reporter: ["text", "lcov"], // "lcov" also generates HTML
    },
});
