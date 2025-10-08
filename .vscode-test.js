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
const { version, publisher, name } = require("./package.json");

const isCIBuild = process.env["CI"] === "1";

const dataDir = process.env["VSCODE_DATA_DIR"];

// Check if we're debugging by looking at the process executable. Unfortunately, the VS Code debugger
// doesn't seem to allow setting environment variables on a launched extension host.
const processPath = process.env["_"] ?? "";
const isDebugRun = !isCIBuild && !processPath.endsWith("node_modules/.bin/vscode-test");

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
    "--no-xshm",
];
if (dataDir) {
    launchArgs.push("--user-data-dir", dataDir);
}

const installExtensions = [];
const extensionDependencies = [];
let vsixPath = process.env["VSCODE_SWIFT_VSIX"];
let versionStr = version;
let extensionDevelopmentPath;
if (vsixPath) {
    // https://github.com/swiftlang/vscode-swift/issues/1751
    // Will install extensions before CI tests run
    installExtensions.push("vadimcn.vscode-lldb", "llvm-vs-code-extensions.lldb-dap");

    // Absolute path to vsix needed
    if (!path.isAbsolute(vsixPath)) {
        vsixPath = path.join(__dirname, vsixPath);
    }
    log("Installing VSIX " + vsixPath);
    installExtensions.push(vsixPath);

    // Determine version to use
    const match = /swift-vscode-(\d+.\d+.\d+(-dev)?)(-\d+)?.vsix/g.exec(path.basename(vsixPath));
    if (match) {
        versionStr = match[1];
    }
    log("Running tests against extension version " + versionStr);

    extensionDevelopmentPath = `${__dirname}/.vscode-test/extensions/${publisher}.${name}-${versionStr}`;
    log("Running tests against extension development path " + extensionDevelopmentPath);
} else {
    extensionDependencies.push("vadimcn.vscode-lldb", "llvm-vs-code-extensions.lldb-dap");
}

const vscodeVersion = process.env["VSCODE_VERSION"] ?? "stable";
log("Running tests against VS Code version " + vscodeVersion);

const installConfigs = [];
for (const ext of installExtensions) {
    installConfigs.push({
        label: `installExtension-${ext}`,
        installExtensions: [ext],
        launchArgs: launchArgs.concat("--disable-extensions"),
        files: ["dist/test/sleep.test.js"],
        version: vscodeVersion,
        skipExtensionDependencies: true,
        reuseMachineInstall: !isCIBuild,
    });
}

const env = {
    ...process.env,
    RUNNING_UNDER_VSCODE_TEST_CLI: "1",
    VSCODE_DEBUG: isDebugRun ? "1" : "0",
};
log("Running tests against environment:\n" + JSON.stringify(env, undefined, 2));

module.exports = defineConfig({
    tests: [
        ...installConfigs,
        {
            label: "integrationTests",
            files: ["dist/test/common.js", "dist/test/integration-tests/**/*.test.js"],
            version: vscodeVersion,
            workspaceFolder: "./assets/test",
            launchArgs,
            extensionDevelopmentPath,
            env,
            mocha: {
                ui: "tdd",
                color: true,
                timeout,
                forbidOnly: isCIBuild,
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
            installExtensions: extensionDependencies,
            skipExtensionDependencies: installConfigs.length > 0,
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
            extensionDevelopmentPath,
            env,
            mocha: {
                ui: "tdd",
                color: true,
                timeout,
                forbidOnly: isCIBuild,
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
            installExtensions: extensionDependencies,
            skipExtensionDependencies: installConfigs.length > 0,
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
                forbidOnly: isCIBuild,
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
