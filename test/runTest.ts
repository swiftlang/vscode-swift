//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as cp from "child_process";
import * as path from "path";
import {
    runTests,
    downloadAndUnzipVSCode,
    resolveCliPathFromVSCodeExecutablePath,
} from "@vscode/test-electron";

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, "../../");

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");

        const vscodeExecutablePath = await downloadAndUnzipVSCode();
        const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);

        // Use cp.spawn / cp.exec for custom setup
        cp.spawnSync(cliPath, ["--install-extension", "vadimcn.vscode-lldb"], {
            encoding: "utf-8",
            stdio: "inherit",
        });

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                "--disable-workspace-trust",
                "--disable-gpu",
                "--no-sandbox",
                "--no-xshm",
                "--crash-reporter-directory",
                "/code/",
                // Already start in the fixtures dir because we lose debugger connection
                // once we re-open a different folder due to window reloading
                path.join(extensionDevelopmentPath, "assets/test"),
            ],
        });
    } catch (err) {
        console.error("Failed to run tests");
        process.exit(1);
    }
}

main();
